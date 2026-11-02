CREATE TYPE "public"."claim_status" AS ENUM('not_lodged', 'lodged', 'approved', 'declined', 'paid', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."damage_status" AS ENUM('open', 'repaired', 'not_repairing');--> statement-breakpoint
CREATE TABLE "damage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"rental_id" uuid,
	"renter_id" uuid,
	"found_on" date NOT NULL,
	"description" text NOT NULL,
	"x" smallint,
	"y" smallint,
	"status" "damage_status" DEFAULT 'open' NOT NULL,
	"status_note" text,
	"return_inspection_id" uuid,
	"damage_mark_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "damage_records_id_operator_unique" UNIQUE("id","operator_id"),
	CONSTRAINT "damage_records_one_per_mark" UNIQUE("operator_id","damage_mark_id"),
	CONSTRAINT "damage_records_position" CHECK (("damage_records"."x" is null) = ("damage_records"."y" is null)
        and ("damage_records"."x" is null or ("damage_records"."x" between 0 and 1000
          and "damage_records"."y" between 0 and 1000))),
	CONSTRAINT "damage_records_not_repairing_note" CHECK ("damage_records"."status" <> 'not_repairing' or "damage_records"."status_note" is not null),
	CONSTRAINT "damage_records_from_return" CHECK (("damage_records"."damage_mark_id" is null) or ("damage_records"."return_inspection_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "insurance_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"damage_record_id" uuid NOT NULL,
	"policy_id" uuid,
	"insurer" text NOT NULL,
	"claim_number" text,
	"status" "claim_status" DEFAULT 'not_lodged' NOT NULL,
	"excess_cents" integer,
	"lodged_on" date,
	"settled_on" date,
	"payout_cents" integer,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insurance_claims_one_per_damage" UNIQUE("operator_id","damage_record_id"),
	CONSTRAINT "insurance_claims_excess" CHECK ("insurance_claims"."excess_cents" is null or "insurance_claims"."excess_cents" >= 0),
	CONSTRAINT "insurance_claims_payout" CHECK ("insurance_claims"."payout_cents" is null or "insurance_claims"."payout_cents" >= 0),
	CONSTRAINT "insurance_claims_dates" CHECK ("insurance_claims"."settled_on" is null or "insurance_claims"."lodged_on" is null or "insurance_claims"."settled_on" >= "insurance_claims"."lodged_on")
);
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "damage_record_id" uuid;--> statement-breakpoint
ALTER TABLE "damage_records" ADD CONSTRAINT "damage_records_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_records" ADD CONSTRAINT "damage_records_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_records" ADD CONSTRAINT "damage_records_vehicle_fk" FOREIGN KEY ("vehicle_id","operator_id") REFERENCES "public"."vehicles"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_records" ADD CONSTRAINT "damage_records_rental_fk" FOREIGN KEY ("rental_id","operator_id") REFERENCES "public"."rentals"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_records" ADD CONSTRAINT "damage_records_renter_fk" FOREIGN KEY ("renter_id","operator_id") REFERENCES "public"."renters"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_records" ADD CONSTRAINT "damage_records_inspection_fk" FOREIGN KEY ("return_inspection_id","operator_id") REFERENCES "public"."inspections"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_records" ADD CONSTRAINT "damage_records_mark_fk" FOREIGN KEY ("damage_mark_id","operator_id") REFERENCES "public"."inspection_damage_marks"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_damage_record_fk" FOREIGN KEY ("damage_record_id","operator_id") REFERENCES "public"."damage_records"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_policy_fk" FOREIGN KEY ("policy_id","operator_id") REFERENCES "public"."insurance_policies"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "damage_records_vehicle_idx" ON "damage_records" USING btree ("operator_id","vehicle_id","found_on");--> statement-breakpoint
CREATE INDEX "damage_records_rental_idx" ON "damage_records" USING btree ("operator_id","rental_id");--> statement-breakpoint
CREATE INDEX "insurance_claims_operator_status_idx" ON "insurance_claims" USING btree ("operator_id","status");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_damage_record_fk" FOREIGN KEY ("damage_record_id","operator_id") REFERENCES "public"."damage_records"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_damage_record_photos" CHECK ("files"."damage_record_id" is null or ("files"."purpose"::text in ('vehicle_photo', 'vehicle_photo_thumbnail') and "files"."inspection_id" is null));--> statement-breakpoint
-- Each business's own, and the Operator app's only: the admin logins get nothing (rule 5).
ALTER TABLE "damage_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "damage_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Never deleted (rule 13): archived instead. The car, the checklist and its mark never change.
GRANT SELECT, INSERT ON "damage_records" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("rental_id", "renter_id", "found_on", "description", "x", "y", "status",
  "status_note", "updated_at", "archived_at") ON "damage_records" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "damage_records_web_tenant" ON "damage_records" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
ALTER TABLE "insurance_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "insurance_claims" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "insurance_claims" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("policy_id", "insurer", "claim_number", "status", "excess_cents", "lodged_on",
  "settled_on", "payout_cents", "notes", "updated_at") ON "insurance_claims" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "insurance_claims_web_tenant" ON "insurance_claims" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());
