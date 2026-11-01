ALTER TABLE "renter_links" ADD CONSTRAINT "renter_links_id_renter_operator_unique" UNIQUE("id","renter_id","operator_id");--> statement-breakpoint
ALTER TABLE "renter_submissions" DROP CONSTRAINT "renter_submissions_link_fk";
--> statement-breakpoint
ALTER TABLE "renter_submissions" ADD CONSTRAINT "renter_submissions_link_fk" FOREIGN KEY ("link_id","renter_id","operator_id") REFERENCES "public"."renter_links"("id","renter_id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_renter_link_idx" ON "files" USING btree ("operator_id","renter_link_id") WHERE "files"."renter_link_id" is not null;--> statement-breakpoint
CREATE INDEX "files_submission_idx" ON "files" USING btree ("operator_id","submission_id") WHERE "files"."submission_id" is not null;--> statement-breakpoint
CREATE INDEX "files_licence_scans_in_use_idx" ON "files" USING btree ("confirmed_at") WHERE "files"."purpose" = 'renter_licence_scan' and "files"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "renter_submissions_link_idx" ON "renter_submissions" USING btree ("operator_id","link_id");--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_identity_area" CHECK (("files"."purpose"::text in ('vehicle_identity_attachment', 'renter_licence_scan', 'renter_submitted_scan')) = ("files"."storage_area"::text = 'identity'));--> statement-breakpoint
ALTER TABLE "renter_submissions" ADD CONSTRAINT "renter_submissions_email_lower_case" CHECK ("renter_submissions"."email" = lower("renter_submissions"."email"));--> statement-breakpoint
ALTER TABLE "renter_submissions" ADD CONSTRAINT "renter_submissions_licence" CHECK (("renter_submissions"."licence_country" is not null) = ("renter_submissions"."licence_issued_in"::text = 'overseas')
        and "renter_submissions"."licence_number" ~ '^[A-Z0-9]{1,20}$');--> statement-breakpoint

-- History can't be wiped in bulk either: TRUNCATE skips row triggers.
CREATE TRIGGER "activity_log_no_truncate"
  BEFORE TRUNCATE ON "activity_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "admin_activity_log_no_truncate"
  BEFORE TRUNCATE ON "admin_activity_log"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint

-- Each login writes history only as who it is: the admin app only as an
-- Admin, the Operator sign-in only as a User or the System.
ALTER POLICY "activity_log_admin_write" ON "activity_log"
  WITH CHECK ("actor_type"::text = 'admin');--> statement-breakpoint
ALTER POLICY "activity_log_auth_write" ON "activity_log"
  WITH CHECK ("actor_type"::text IN ('user', 'system'));
