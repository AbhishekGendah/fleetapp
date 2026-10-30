CREATE TYPE "public"."renter_status" AS ENUM('active', 'do_not_rent');--> statement-breakpoint
CREATE TABLE "renters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"preferred_name" text,
	"date_of_birth" date,
	"phone" text,
	"email" text,
	"residential_address" text,
	"postal_address" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"emergency_contact_relationship" text,
	"status" "renter_status" DEFAULT 'active' NOT NULL,
	"do_not_rent_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "renters_id_operator_unique" UNIQUE("id","operator_id"),
	CONSTRAINT "renters_has_contact" CHECK (num_nonnulls("renters"."phone", "renters"."email") > 0),
	CONSTRAINT "renters_email_lower_case" CHECK ("renters"."email" = lower("renters"."email")),
	CONSTRAINT "renters_do_not_rent_reason" CHECK (("renters"."status" = 'do_not_rent') = ("renters"."do_not_rent_reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "renters" ADD CONSTRAINT "renters_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "renters_operator_name_idx" ON "renters" USING btree ("operator_id","full_name");--> statement-breakpoint
-- An Operator reads, adds and edits only its own Renters; one no longer
-- needed is archived, never deleted. The admin app is granted nothing here:
-- Renters' details are personal information Admins never see (rule 5).
ALTER TABLE "renters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "renters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "renters" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("full_name", "preferred_name", "date_of_birth", "phone", "email", "residential_address", "postal_address", "emergency_contact_name", "emergency_contact_phone", "emergency_contact_relationship", "status", "do_not_rent_reason", "updated_at", "archived_at") ON "renters" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "renters_web_tenant" ON "renters" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());
