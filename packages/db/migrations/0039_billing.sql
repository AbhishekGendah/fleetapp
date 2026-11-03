CREATE TYPE "public"."billing_document_kind" AS ENUM('invoice', 'credit_note', 'receipt');--> statement-breakpoint
CREATE TYPE "public"."numbering_series" AS ENUM('invoice', 'receipt');--> statement-breakpoint
ALTER TYPE "public"."issued_document_kind" ADD VALUE 'invoice';--> statement-breakpoint
ALTER TYPE "public"."issued_document_kind" ADD VALUE 'credit_note';--> statement-breakpoint
ALTER TYPE "public"."issued_document_kind" ADD VALUE 'receipt';--> statement-breakpoint
ALTER TYPE "public"."issued_document_kind" ADD VALUE 'statement';--> statement-breakpoint
CREATE TABLE "billing_document_lines" (
	"operator_id" uuid NOT NULL,
	"rental_id" uuid NOT NULL,
	"billing_document_id" uuid NOT NULL,
	"ledger_line_id" uuid NOT NULL,
	CONSTRAINT "billing_document_lines_pk" PRIMARY KEY("ledger_line_id")
);
--> statement-breakpoint
CREATE TABLE "billing_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"rental_id" uuid NOT NULL,
	"kind" "billing_document_kind" NOT NULL,
	"number" integer NOT NULL,
	"number_text" text NOT NULL,
	"issued_on" date NOT NULL,
	"is_tax_document" boolean NOT NULL,
	"total_cents" integer NOT NULL,
	"gst_cents" integer NOT NULL,
	"relates_to_id" uuid,
	"issued_document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_documents_id_operator_unique" UNIQUE("id","operator_id"),
	CONSTRAINT "billing_documents_id_rental_unique" UNIQUE("id","operator_id","rental_id"),
	CONSTRAINT "billing_documents_issued_document_unique" UNIQUE("issued_document_id"),
	CONSTRAINT "billing_documents_total" CHECK ("billing_documents"."total_cents" >= 0),
	CONSTRAINT "billing_documents_gst" CHECK ("billing_documents"."gst_cents" >= 0 and "billing_documents"."gst_cents" <= "billing_documents"."total_cents"),
	CONSTRAINT "billing_documents_relates_to" CHECK ("billing_documents"."relates_to_id" is null or "billing_documents"."kind" = 'credit_note'),
	CONSTRAINT "billing_documents_number_text" CHECK (length("billing_documents"."number_text") > 0)
);
--> statement-breakpoint
CREATE TABLE "document_numbering" (
	"operator_id" uuid NOT NULL,
	"series" "numbering_series" NOT NULL,
	"prefix" text NOT NULL,
	"next_number" integer NOT NULL,
	"is_started" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_numbering_pk" PRIMARY KEY("operator_id","series"),
	CONSTRAINT "document_numbering_next_number" CHECK ("document_numbering"."next_number" between 1 and 100000000),
	CONSTRAINT "document_numbering_prefix" CHECK (length("document_numbering"."prefix") <= 10)
);
--> statement-breakpoint
ALTER TABLE "billing_document_lines" ADD CONSTRAINT "billing_document_lines_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_document_lines" ADD CONSTRAINT "billing_document_lines_document_fk" FOREIGN KEY ("billing_document_id","operator_id","rental_id") REFERENCES "public"."billing_documents"("id","operator_id","rental_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_document_lines" ADD CONSTRAINT "billing_document_lines_ledger_line_fk" FOREIGN KEY ("ledger_line_id","operator_id","rental_id") REFERENCES "public"."ledger_lines"("id","operator_id","rental_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD CONSTRAINT "billing_documents_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD CONSTRAINT "billing_documents_rental_fk" FOREIGN KEY ("rental_id","operator_id") REFERENCES "public"."rentals"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD CONSTRAINT "billing_documents_relates_to_fk" FOREIGN KEY ("relates_to_id","operator_id","rental_id") REFERENCES "public"."billing_documents"("id","operator_id","rental_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_documents" ADD CONSTRAINT "billing_documents_issued_document_fk" FOREIGN KEY ("issued_document_id","operator_id") REFERENCES "public"."issued_documents"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_numbering" ADD CONSTRAINT "document_numbering_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_document_lines_document_idx" ON "billing_document_lines" USING btree ("operator_id","billing_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_documents_invoice_number_unique" ON "billing_documents" USING btree ("operator_id","number") WHERE "billing_documents"."kind" in ('invoice', 'credit_note');--> statement-breakpoint
CREATE UNIQUE INDEX "billing_documents_receipt_number_unique" ON "billing_documents" USING btree ("operator_id","number") WHERE "billing_documents"."kind" = 'receipt';--> statement-breakpoint
CREATE INDEX "billing_documents_rental_idx" ON "billing_documents" USING btree ("operator_id","rental_id");--> statement-breakpoint

-- Numbers with no gaps and no repeats (rule 17). Before the first document the
-- business may set any starting number; from then the number only moves on by
-- one, as each document takes it.
CREATE FUNCTION "app"."check_document_numbering"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF OLD.is_started AND NOT NEW.is_started THEN
    RAISE EXCEPTION 'numbering that has started cannot be reset' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.is_started AND NEW.next_number NOT IN (OLD.next_number, OLD.next_number + 1) THEN
    RAISE EXCEPTION 'a started number can only move on by one' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "document_numbering_checked"
  BEFORE UPDATE ON "document_numbering"
  FOR EACH ROW EXECUTE FUNCTION "app"."check_document_numbering"();--> statement-breakpoint

-- At commit, every number taken has its document: a number taken by an issue
-- that then failed would be a gap, so the whole transaction is refused instead.
CREATE FUNCTION "app"."check_document_number_used"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT NEW.is_started OR NEW.next_number = OLD.next_number THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "billing_documents"
    WHERE operator_id = NEW.operator_id
      AND number = NEW.next_number - 1
      AND (CASE WHEN kind = 'receipt' THEN 'receipt' ELSE 'invoice' END)::"numbering_series" = NEW.series
  ) THEN
    RAISE EXCEPTION 'number % was taken without a document', NEW.next_number - 1
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "document_numbering_each_number_used"
  AFTER UPDATE ON "document_numbering"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "app"."check_document_number_used"();--> statement-breakpoint

-- A document's number must be one its business has already taken.
CREATE FUNCTION "app"."check_billing_document_number"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  taken_up_to integer;
BEGIN
  SELECT next_number INTO taken_up_to FROM "document_numbering"
    WHERE operator_id = NEW.operator_id
      AND series = (CASE WHEN NEW.kind = 'receipt' THEN 'receipt' ELSE 'invoice' END)::"numbering_series"
      AND is_started;
  IF taken_up_to IS NULL OR NEW.number >= taken_up_to THEN
    RAISE EXCEPTION 'number % has not been taken', NEW.number USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "billing_documents_number_checked"
  BEFORE INSERT ON "billing_documents"
  FOR EACH ROW EXECUTE FUNCTION "app"."check_billing_document_number"();--> statement-breakpoint

-- Each document carries only its own kind of line: charges on an invoice,
-- credits and reversals on a credit note, payments on a receipt.
CREATE FUNCTION "app"."check_billing_document_line"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  document_kind "billing_document_kind";
  line_kind "ledger_line_kind";
BEGIN
  SELECT kind INTO document_kind FROM "billing_documents" WHERE id = NEW.billing_document_id;
  SELECT kind INTO line_kind FROM "ledger_lines" WHERE id = NEW.ledger_line_id;
  IF NOT (
    (document_kind = 'invoice' AND line_kind = 'charge')
    OR (document_kind = 'credit_note' AND line_kind IN ('credit', 'reversal'))
    OR (document_kind = 'receipt' AND line_kind = 'payment')
  ) THEN
    RAISE EXCEPTION 'a % cannot carry a % line', document_kind, line_kind
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "billing_document_lines_kind_checked"
  BEFORE INSERT ON "billing_document_lines"
  FOR EACH ROW EXECUTE FUNCTION "app"."check_billing_document_line"();--> statement-breakpoint

-- Issued documents are fixed (rule 12): added, never changed or removed.
CREATE TRIGGER "billing_documents_append_only"
  BEFORE UPDATE OR DELETE ON "billing_documents"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "billing_documents_no_truncate"
  BEFORE TRUNCATE ON "billing_documents"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "billing_document_lines_append_only"
  BEFORE UPDATE OR DELETE ON "billing_document_lines"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "billing_document_lines_no_truncate"
  BEFORE TRUNCATE ON "billing_document_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "document_numbering_no_delete"
  BEFORE DELETE ON "document_numbering"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "document_numbering_no_truncate"
  BEFORE TRUNCATE ON "document_numbering"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint

-- The business's own, and the Operator app's only: the admin logins get nothing (rule 5).
ALTER TABLE "document_numbering" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_numbering" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "document_numbering" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("prefix", "next_number", "is_started", "updated_at") ON "document_numbering" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "document_numbering_web_tenant" ON "document_numbering" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
ALTER TABLE "billing_documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing_documents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "billing_documents" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "billing_documents_web_tenant" ON "billing_documents" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
ALTER TABLE "billing_document_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing_document_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "billing_document_lines" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "billing_document_lines_web_tenant" ON "billing_document_lines" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint

-- The nightly catch-up has no session (rule 3): it asks which businesses have
-- recent ledger lines on no document yet, then works one business at a time in
-- its own tenant context. Only ids cross between businesses here. As for
-- rentals in 0038, the owner gets read policies so the SECURITY DEFINER
-- function sees the rows; the Operator app's role may only call it.
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY "ledger_lines_owner_billing_lookup" ON "ledger_lines" FOR SELECT TO %I USING (true)',
    current_user
  );
  EXECUTE format(
    'CREATE POLICY "billing_document_lines_owner_lookup" ON "billing_document_lines" FOR SELECT TO %I USING (true)',
    current_user
  );
END
$$;--> statement-breakpoint
CREATE FUNCTION "app"."operators_with_unbilled_lines"(
  "created_since" timestamp with time zone
) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT DISTINCT "line"."operator_id" FROM "public"."ledger_lines" AS "line"
  WHERE "line"."created_at" >= "created_since"
    AND "line"."kind" IN ('charge', 'credit', 'payment', 'reversal')
    AND NOT EXISTS (
      SELECT 1 FROM "public"."billing_document_lines" AS "billed"
      WHERE "billed"."ledger_line_id" = "line"."id"
    )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."operators_with_unbilled_lines"(timestamp with time zone) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."operators_with_unbilled_lines"(timestamp with time zone) TO "web_app_role";
