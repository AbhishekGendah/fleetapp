CREATE TYPE "public"."renter_submission_status" AS ENUM('waiting', 'approved', 'sent_back');--> statement-breakpoint
ALTER TYPE "public"."file_purpose" ADD VALUE 'renter_submitted_scan';--> statement-breakpoint
CREATE TABLE "renter_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"renter_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"status" "renter_submission_status" DEFAULT 'waiting' NOT NULL,
	"full_name" text NOT NULL,
	"preferred_name" text,
	"date_of_birth" date NOT NULL,
	"phone" text,
	"email" text,
	"residential_address" text NOT NULL,
	"postal_address" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"emergency_contact_relationship" text,
	"licence_issued_in" "licence_issuer" NOT NULL,
	"licence_country" text,
	"licence_number" text NOT NULL,
	"licence_class" "licence_class" NOT NULL,
	"licence_type" "licence_type" NOT NULL,
	"licence_expires_on" date NOT NULL,
	"review_note" text,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "renter_submissions_id_operator_unique" UNIQUE("id","operator_id"),
	CONSTRAINT "renter_submissions_has_contact" CHECK (num_nonnulls("renter_submissions"."phone", "renter_submissions"."email") > 0),
	CONSTRAINT "renter_submissions_reviewed" CHECK (("renter_submissions"."status" = 'waiting') = ("renter_submissions"."reviewed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "files" DROP CONSTRAINT "files_licence_scan_links";--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "renter_link_id" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "submission_id" uuid;--> statement-breakpoint
ALTER TABLE "renter_links" ADD COLUMN "address_searches" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "renter_submissions" ADD CONSTRAINT "renter_submissions_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renter_submissions" ADD CONSTRAINT "renter_submissions_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renter_submissions" ADD CONSTRAINT "renter_submissions_renter_fk" FOREIGN KEY ("renter_id","operator_id") REFERENCES "public"."renters"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renter_submissions" ADD CONSTRAINT "renter_submissions_link_fk" FOREIGN KEY ("link_id","operator_id") REFERENCES "public"."renter_links"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "renter_submissions_one_waiting_per_renter" ON "renter_submissions" USING btree ("operator_id","renter_id") WHERE "renter_submissions"."status" = 'waiting';--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_renter_link_fk" FOREIGN KEY ("renter_link_id","operator_id") REFERENCES "public"."renter_links"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_submission_fk" FOREIGN KEY ("submission_id","operator_id") REFERENCES "public"."renter_submissions"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "files_one_link_photo_per_side" ON "files" USING btree ("operator_id","renter_link_id","licence_side") WHERE "files"."renter_link_id" is not null and "files"."submission_id" is null and "files"."confirmed_at" is not null and "files"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_licence_scan_links" CHECK (("files"."purpose"::text = 'renter_licence_scan') = ("files"."renter_id" is not null)
        and ("files"."purpose"::text <> 'renter_submitted_scan' or ("files"."renter_link_id" is not null and "files"."renter_id" is null))
        and ("files"."purpose"::text in ('renter_licence_scan', 'renter_submitted_scan')) = ("files"."licence_side" is not null)
        and ("files"."renter_link_id" is null or "files"."purpose"::text in ('renter_licence_scan', 'renter_submitted_scan'))
        and ("files"."submission_id" is null or "files"."renter_link_id" is not null)
        and ("files"."licence_side" is null or "files"."vehicle_id" is null));--> statement-breakpoint
-- What a Renter sends through a link waits here for the Operator. The
-- Operator app reads and adds only its own Operator's, and only changes the
-- review; nothing is deleted. The admin app is granted nothing (rule 5).
ALTER TABLE "renter_submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "renter_submissions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "renter_submissions" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("status", "review_note", "reviewed_by_user_id", "reviewed_at", "updated_at") ON "renter_submissions" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "renter_submissions_web_tenant" ON "renter_submissions" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
-- A link's photos join their submission when it is sent; a link counts its
-- address searches.
GRANT UPDATE ("submission_id") ON "files" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("address_searches") ON "renter_links" TO "web_app_role";
