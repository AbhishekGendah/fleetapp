CREATE TYPE "public"."contract_template_kind" AS ENUM('contract', 'swap_form', 'change_of_terms');--> statement-breakpoint
CREATE TYPE "public"."issued_document_kind" AS ENUM('contract', 'handover_report', 'return_report', 'swap_form', 'change_of_terms');--> statement-breakpoint
ALTER TYPE "public"."file_purpose" ADD VALUE 'issued_document';--> statement-breakpoint
CREATE TABLE "contract_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_template_versions_id_operator_unique" UNIQUE("id","operator_id"),
	CONSTRAINT "contract_template_versions_number_unique" UNIQUE("operator_id","template_id","version"),
	CONSTRAINT "contract_template_versions_version" CHECK ("contract_template_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "contract_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"kind" "contract_template_kind" NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "contract_templates_id_operator_unique" UNIQUE("id","operator_id")
);
--> statement-breakpoint
CREATE TABLE "issued_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"rental_id" uuid NOT NULL,
	"kind" "issued_document_kind" NOT NULL,
	"version" integer NOT NULL,
	"template_version_id" uuid,
	"file_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"issued_by_user_id" uuid,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issued_documents_version_unique" UNIQUE("operator_id","rental_id","kind","version"),
	CONSTRAINT "issued_documents_file_unique" UNIQUE("file_id"),
	CONSTRAINT "issued_documents_version" CHECK ("issued_documents"."version" > 0),
	CONSTRAINT "issued_documents_sha256" CHECK ("issued_documents"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "contract_template_versions" ADD CONSTRAINT "contract_template_versions_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_template_versions" ADD CONSTRAINT "contract_template_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_template_versions" ADD CONSTRAINT "contract_template_versions_template_fk" FOREIGN KEY ("template_id","operator_id") REFERENCES "public"."contract_templates"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_rental_fk" FOREIGN KEY ("rental_id","operator_id") REFERENCES "public"."rentals"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_template_version_fk" FOREIGN KEY ("template_version_id","operator_id") REFERENCES "public"."contract_template_versions"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_file_fk" FOREIGN KEY ("file_id","operator_id") REFERENCES "public"."files"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_templates_one_default_per_kind" ON "contract_templates" USING btree ("operator_id","kind") WHERE "contract_templates"."is_default" and "contract_templates"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "contract_templates_operator_idx" ON "contract_templates" USING btree ("operator_id","kind");--> statement-breakpoint

-- A template version and an issued document are never changed or removed
-- (rule 12): a correction is a new version.
CREATE TRIGGER "contract_template_versions_append_only"
  BEFORE UPDATE OR DELETE ON "contract_template_versions"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "contract_template_versions_no_truncate"
  BEFORE TRUNCATE ON "contract_template_versions"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "issued_documents_append_only"
  BEFORE UPDATE OR DELETE ON "issued_documents"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "issued_documents_no_truncate"
  BEFORE TRUNCATE ON "issued_documents"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint

-- An issued document's PDF is kept as long as the document: the file can
-- never be binned, moved or removed, whoever asks.
CREATE FUNCTION "app"."keep_issued_document_files"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF OLD.purpose::text = 'issued_document' AND (
      TG_OP = 'DELETE'
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
      OR NEW.purged_at IS DISTINCT FROM OLD.purged_at
      OR NEW.object_key IS DISTINCT FROM OLD.object_key
      OR NEW.purpose IS DISTINCT FROM OLD.purpose
    ) THEN
      RAISE EXCEPTION 'An issued document''s file is kept for good.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END;
  $$;--> statement-breakpoint
CREATE TRIGGER "files_keep_issued_documents"
  BEFORE UPDATE OR DELETE ON "files"
  FOR EACH ROW EXECUTE FUNCTION "app"."keep_issued_document_files"();--> statement-breakpoint

-- Each business's own, and the Operator app's only: the admin logins get nothing.
ALTER TABLE "contract_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contract_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "contract_templates" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("name", "is_default", "archived_at", "updated_at") ON "contract_templates" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "contract_templates_web_tenant" ON "contract_templates" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint

ALTER TABLE "contract_template_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contract_template_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "contract_template_versions" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "contract_template_versions_web_tenant" ON "contract_template_versions" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint

ALTER TABLE "issued_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "issued_documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "issued_documents" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "issued_documents_web_tenant" ON "issued_documents" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());
