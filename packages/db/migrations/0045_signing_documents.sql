CREATE TABLE "document_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"recipient" text NOT NULL,
	"outcome" text NOT NULL,
	"sent_by_user_id" uuid,
	"tried_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_emails_recipient" CHECK ("document_emails"."recipient" in ('renter', 'business')),
	CONSTRAINT "document_emails_outcome" CHECK ("document_emails"."outcome" in ('sent', 'failed', 'no_address'))
);
--> statement-breakpoint
DROP INDEX "renter_links_one_live_per_purpose";--> statement-breakpoint
ALTER TABLE "renter_links" ADD COLUMN "used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "signature_method" text;--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "typed_name" text;--> statement-breakpoint
ALTER TABLE "document_emails" ADD CONSTRAINT "document_emails_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_emails" ADD CONSTRAINT "document_emails_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_emails" ADD CONSTRAINT "document_emails_document_fk" FOREIGN KEY ("document_id","operator_id") REFERENCES "public"."issued_documents"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_emails_document_idx" ON "document_emails" USING btree ("operator_id","document_id","tried_at");--> statement-breakpoint
CREATE UNIQUE INDEX "renter_links_one_live_per_purpose" ON "renter_links" USING btree ("operator_id","renter_id","purpose",coalesce("rental_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("rental_change_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "renter_links"."cancelled_at" is null;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_signature" CHECK (("inspections"."signature_method" is null or "inspections"."signature_method" in ('drawn', 'typed'))
        and ("inspections"."signature_method" = 'typed') = ("inspections"."typed_name" is not null));--> statement-breakpoint

-- Each try at emailing a document's copy (review G7-1, G9-9): never changed
-- or removed, a resend is a new row. The business's own, and the Operator
-- app's only: the admin logins get nothing (rule 5).
CREATE TRIGGER "document_emails_append_only"
  BEFORE UPDATE OR DELETE ON "document_emails"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "document_emails_no_truncate"
  BEFORE TRUNCATE ON "document_emails"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
ALTER TABLE "document_emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_emails" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "document_emails" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "document_emails_web_tenant" ON "document_emails" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint

-- A link records when it was used to sign (review A3-7).
GRANT UPDATE ("used_at") ON "renter_links" TO "web_app_role";--> statement-breakpoint

-- How the Renter signed on the business's phone (review G9-10).
GRANT UPDATE ("signature_method", "typed_name") ON "inspections" TO "web_app_role";--> statement-breakpoint

-- Whether a link was used to sign, from its secret alone: a Renter reopening
-- a signed link is told it is signed, not that it "may have expired". Says
-- nothing else, so nothing about the Renter shows before their code (rule 26).
CREATE FUNCTION "app"."renter_link_was_used"("token_hash" text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "public"."renter_links" "l"
    WHERE "l"."token_hash" = "renter_link_was_used"."token_hash"
      AND "l"."used_at" IS NOT NULL
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."renter_link_was_used"(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."renter_link_was_used"(text) TO "web_app_role";--> statement-breakpoint

-- A photo can't be attached to a finished checklist (review A6-10): an upload
-- that finishes after the report was signed would be kept with a checklist
-- whose report never showed it. Everything else is as in 0033.
CREATE OR REPLACE FUNCTION "app"."keep_finished_inspection_photos"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.inspection_id IS NOT NULL AND NOT "app"."is_inspection_in_progress"(NEW.inspection_id) THEN
        RAISE EXCEPTION 'Photos are added only while the checklist is in progress.'
          USING ERRCODE = 'restrict_violation';
      END IF;
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.inspection_id IS NOT NULL AND OLD.confirmed_at IS NULL
      AND NEW.confirmed_at IS NOT NULL
      AND NOT "app"."is_inspection_in_progress"(OLD.inspection_id)
    THEN
      RAISE EXCEPTION 'Photos are added only while the checklist is in progress.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.inspection_id IS NOT NULL AND OLD.confirmed_at IS NOT NULL
      AND NOT "app"."is_inspection_in_progress"(OLD.inspection_id)
      AND EXISTS (SELECT 1 FROM "inspections" WHERE id = OLD.inspection_id AND status = 'completed')
      AND (TG_OP = 'DELETE'
        OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
        OR NEW.purged_at IS DISTINCT FROM OLD.purged_at
        OR NEW.object_key IS DISTINCT FROM OLD.object_key)
    THEN
      RAISE EXCEPTION 'A finished checklist''s photos are kept with it.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END;
  $$;
