CREATE TYPE "public"."signing_evidence_step" AS ENUM('code_verified', 'contract_viewed', 'signed');--> statement-breakpoint
ALTER TYPE "public"."renter_link_purpose" ADD VALUE 'sign_contract';--> statement-breakpoint
CREATE TABLE "signing_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"rental_id" uuid NOT NULL,
	"step" "signing_evidence_step" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"issued_document_id" uuid
);
--> statement-breakpoint
DROP INDEX "renter_links_one_live_per_purpose";--> statement-breakpoint
ALTER TABLE "dev_email_outbox" ADD COLUMN "attachment_names" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "renter_links" ADD COLUMN "rental_id" uuid;--> statement-breakpoint
ALTER TABLE "renter_links" ADD COLUMN "template_version_id" uuid;--> statement-breakpoint
ALTER TABLE "renter_links" ADD COLUMN "contract_fingerprint" text;--> statement-breakpoint
ALTER TABLE "signing_evidence" ADD CONSTRAINT "signing_evidence_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_evidence" ADD CONSTRAINT "signing_evidence_link_fk" FOREIGN KEY ("link_id","operator_id") REFERENCES "public"."renter_links"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signing_evidence" ADD CONSTRAINT "signing_evidence_rental_fk" FOREIGN KEY ("rental_id","operator_id") REFERENCES "public"."rentals"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_id_operator_unique" UNIQUE("id","operator_id");--> statement-breakpoint
ALTER TABLE "signing_evidence" ADD CONSTRAINT "signing_evidence_document_fk" FOREIGN KEY ("issued_document_id","operator_id") REFERENCES "public"."issued_documents"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signing_evidence_link_idx" ON "signing_evidence" USING btree ("operator_id","link_id");--> statement-breakpoint
ALTER TABLE "renter_links" ADD CONSTRAINT "renter_links_rental_fk" FOREIGN KEY ("rental_id","operator_id") REFERENCES "public"."rentals"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renter_links" ADD CONSTRAINT "renter_links_template_version_fk" FOREIGN KEY ("template_version_id","operator_id") REFERENCES "public"."contract_template_versions"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "renter_links_one_live_per_purpose" ON "renter_links" USING btree ("operator_id","renter_id","purpose",coalesce("rental_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "renter_links"."cancelled_at" is null;--> statement-breakpoint
ALTER TABLE "renter_links" ADD CONSTRAINT "renter_links_signing_details" CHECK (("renter_links"."purpose"::text = 'sign_contract') = ("renter_links"."rental_id" is not null)
        and ("renter_links"."rental_id" is null) = ("renter_links"."template_version_id" is null)
        and ("renter_links"."rental_id" is null) = ("renter_links"."contract_fingerprint" is null)
        and ("renter_links"."contract_fingerprint" is null or "renter_links"."contract_fingerprint" ~ '^[0-9a-f]{64}$'));--> statement-breakpoint

-- Signing evidence is never changed or removed: it is the record that the
-- Renter signed (Electronic Transactions Act).
CREATE TRIGGER "signing_evidence_append_only"
  BEFORE UPDATE OR DELETE ON "signing_evidence"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "signing_evidence_no_truncate"
  BEFORE TRUNCATE ON "signing_evidence"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint

-- The business's own, and the Operator app's only: the admin logins get nothing.
ALTER TABLE "signing_evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "signing_evidence" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "signing_evidence" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "signing_evidence_web_tenant" ON "signing_evidence" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());
