CREATE TYPE "public"."rental_change_kind" AS ENUM('end_date', 'make_ongoing', 'weekly_rate');--> statement-breakpoint
CREATE TYPE "public"."rental_change_status" AS ENUM('applied', 'waiting_for_signature', 'withdrawn');--> statement-breakpoint
ALTER TYPE "public"."renter_link_purpose" ADD VALUE 'sign_change';--> statement-breakpoint
CREATE TABLE "rental_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"rental_id" uuid NOT NULL,
	"kind" "rental_change_kind" NOT NULL,
	"status" "rental_change_status" NOT NULL,
	"type_before" "rental_type",
	"type_after" "rental_type",
	"end_before" timestamp with time zone,
	"end_after" timestamp with time zone,
	"is_short_notice" boolean DEFAULT false NOT NULL,
	"rate_before_cents" integer,
	"rate_after_cents" integer,
	"applies_from" date,
	"reason" text NOT NULL,
	"document_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "rental_changes_id_operator_unique" UNIQUE("id","operator_id"),
	CONSTRAINT "rental_changes_document_unique" UNIQUE("document_id"),
	CONSTRAINT "rental_changes_end_values" CHECK (("rental_changes"."kind" = 'weekly_rate') = ("rental_changes"."type_after" is null)
        and ("rental_changes"."kind" <> 'end_date' or ("rental_changes"."end_after" is not null and "rental_changes"."type_after" = 'fixed_term'))
        and ("rental_changes"."kind" <> 'make_ongoing' or ("rental_changes"."end_after" is null and "rental_changes"."type_after" = 'ongoing'))),
	CONSTRAINT "rental_changes_rate_values" CHECK (("rental_changes"."kind" = 'weekly_rate') = ("rental_changes"."rate_after_cents" is not null)
        and ("rental_changes"."rate_after_cents" is null or ("rental_changes"."rate_after_cents" > 0
          and "rental_changes"."rate_before_cents" > 0 and "rental_changes"."applies_from" is not null))),
	CONSTRAINT "rental_changes_status_times" CHECK (("rental_changes"."status" = 'applied') = ("rental_changes"."applied_at" is not null)
        and ("rental_changes"."status" = 'withdrawn') = ("rental_changes"."withdrawn_at" is not null)
        and ("rental_changes"."kind" <> 'weekly_rate' or "rental_changes"."status" <> 'applied' or "rental_changes"."document_id" is not null)),
	CONSTRAINT "rental_changes_reason" CHECK (length(trim("rental_changes"."reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "renter_links" DROP CONSTRAINT "renter_links_signing_details";--> statement-breakpoint
ALTER TABLE "renter_links" ADD COLUMN "rental_change_id" uuid;--> statement-breakpoint
ALTER TABLE "rental_changes" ADD CONSTRAINT "rental_changes_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_changes" ADD CONSTRAINT "rental_changes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_changes" ADD CONSTRAINT "rental_changes_rental_fk" FOREIGN KEY ("rental_id","operator_id") REFERENCES "public"."rentals"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rental_changes_rental_idx" ON "rental_changes" USING btree ("operator_id","rental_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rental_changes_one_rate_waiting" ON "rental_changes" USING btree ("operator_id","rental_id") WHERE "rental_changes"."kind" = 'weekly_rate' and "rental_changes"."status" = 'waiting_for_signature';--> statement-breakpoint
ALTER TABLE "renter_links" ADD CONSTRAINT "renter_links_rental_change_fk" FOREIGN KEY ("rental_change_id","operator_id") REFERENCES "public"."rental_changes"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renter_links" ADD CONSTRAINT "renter_links_signing_details" CHECK (("renter_links"."purpose"::text in ('sign_contract', 'sign_change')) = ("renter_links"."rental_id" is not null)
        and ("renter_links"."purpose"::text = 'sign_change') = ("renter_links"."rental_change_id" is not null)
        and ("renter_links"."rental_id" is null) = ("renter_links"."template_version_id" is null)
        and ("renter_links"."rental_id" is null) = ("renter_links"."contract_fingerprint" is null)
        and ("renter_links"."contract_fingerprint" is null or "renter_links"."contract_fingerprint" ~ '^[0-9a-f]{64}$'));--> statement-breakpoint
-- The signed form (declared here, not in the schema file, to keep the table types from looping).
ALTER TABLE "rental_changes" ADD CONSTRAINT "rental_changes_document_fk" FOREIGN KEY ("document_id","operator_id") REFERENCES "public"."issued_documents"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- A change is history: only its status moves on (waiting to applied or
-- withdrawn) and its signed form is added once. The column grants below
-- already keep every other column fixed; this keeps the moves themselves.
CREATE FUNCTION "app"."check_rental_change_update"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF OLD.document_id IS NOT NULL AND NEW.document_id IS DISTINCT FROM OLD.document_id THEN
      RAISE EXCEPTION 'A change keeps the form it was signed with.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
      AND OLD.status <> 'waiting_for_signature' THEN
      RAISE EXCEPTION 'A change that is % cannot move to %.', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint
CREATE TRIGGER "rental_changes_moves"
  BEFORE UPDATE ON "rental_changes"
  FOR EACH ROW EXECUTE FUNCTION "app"."check_rental_change_update"();--> statement-breakpoint
CREATE TRIGGER "rental_changes_no_delete"
  BEFORE DELETE ON "rental_changes"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "rental_changes_no_truncate"
  BEFORE TRUNCATE ON "rental_changes"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint

-- Each business's own, and the Operator app's only: the admin logins get nothing (rule 5).
ALTER TABLE "rental_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rental_changes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "rental_changes" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("status", "document_id", "applied_at", "withdrawn_at") ON "rental_changes" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "rental_changes_web_tenant" ON "rental_changes" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());
