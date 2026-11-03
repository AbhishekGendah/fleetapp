CREATE TYPE "public"."built_in_charge_type" AS ENUM('weekly_rent', 'part_week_rent', 'late_fee', 'damage', 'excess', 'cleaning', 'toll');--> statement-breakpoint
CREATE TYPE "public"."gst_treatment" AS ENUM('taxable', 'gst_free', 'no_gst');--> statement-breakpoint
CREATE TYPE "public"."ledger_line_kind" AS ENUM('charge', 'payment', 'credit', 'refund', 'reversal');--> statement-breakpoint
CREATE TABLE "charge_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"built_in" "built_in_charge_type",
	"name" text,
	"gst_treatment" "gst_treatment" DEFAULT 'taxable' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charge_types_id_operator_unique" UNIQUE("id","operator_id"),
	CONSTRAINT "charge_types_named" CHECK (("charge_types"."built_in" is null) = ("charge_types"."name" is not null and length(trim("charge_types"."name")) > 0))
);
--> statement-breakpoint
CREATE TABLE "ledger_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"rental_id" uuid NOT NULL,
	"kind" "ledger_line_kind" NOT NULL,
	"charge_type_id" uuid,
	"amount_cents" integer NOT NULL,
	"gst_cents" integer NOT NULL,
	"description" text NOT NULL,
	"effective_on" date NOT NULL,
	"period_start" date,
	"period_end" date,
	"method" "payment_method",
	"reference" text,
	"reverses_id" uuid,
	"damage_record_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_lines_id_rental_unique" UNIQUE("id","operator_id","rental_id"),
	CONSTRAINT "ledger_lines_reversed_once" UNIQUE("reverses_id"),
	CONSTRAINT "ledger_lines_amount" CHECK ("ledger_lines"."amount_cents" > 0),
	CONSTRAINT "ledger_lines_gst" CHECK ("ledger_lines"."gst_cents" >= 0 and "ledger_lines"."gst_cents" <= "ledger_lines"."amount_cents"),
	CONSTRAINT "ledger_lines_description" CHECK (length(trim("ledger_lines"."description")) > 0),
	CONSTRAINT "ledger_lines_reversal" CHECK (("ledger_lines"."kind" = 'reversal') = ("ledger_lines"."reverses_id" is not null)),
	CONSTRAINT "ledger_lines_method" CHECK (("ledger_lines"."kind" in ('payment', 'refund')) = ("ledger_lines"."method" is not null)),
	CONSTRAINT "ledger_lines_charge_type" CHECK (("ledger_lines"."kind" in ('charge', 'credit')) = ("ledger_lines"."charge_type_id" is not null)),
	CONSTRAINT "ledger_lines_period" CHECK (("ledger_lines"."period_start" is null) = ("ledger_lines"."period_end" is null)
        and ("ledger_lines"."period_start" is null or ("ledger_lines"."kind" in ('charge', 'credit')
          and "ledger_lines"."period_end" > "ledger_lines"."period_start")))
);
--> statement-breakpoint
ALTER TABLE "charge_types" ADD CONSTRAINT "charge_types_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_rental_fk" FOREIGN KEY ("rental_id","operator_id") REFERENCES "public"."rentals"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_charge_type_fk" FOREIGN KEY ("charge_type_id","operator_id") REFERENCES "public"."charge_types"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_reverses_fk" FOREIGN KEY ("reverses_id","operator_id","rental_id") REFERENCES "public"."ledger_lines"("id","operator_id","rental_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_damage_fk" FOREIGN KEY ("damage_record_id","operator_id") REFERENCES "public"."damage_records"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "charge_types_one_built_in" ON "charge_types" USING btree ("operator_id","built_in") WHERE "charge_types"."built_in" is not null;--> statement-breakpoint
CREATE INDEX "ledger_lines_rental_idx" ON "ledger_lines" USING btree ("operator_id","rental_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_lines_one_rent_per_period" ON "ledger_lines" USING btree ("operator_id","rental_id","period_start") WHERE "ledger_lines"."kind" = 'charge' and "ledger_lines"."period_start" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_lines_one_credit_per_period" ON "ledger_lines" USING btree ("operator_id","rental_id","period_start") WHERE "ledger_lines"."kind" = 'credit' and "ledger_lines"."period_start" is not null;--> statement-breakpoint

-- A reversal undoes one line exactly: the same amount and GST, never another reversal.
CREATE FUNCTION "app"."check_ledger_reversal"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  reversed_kind "ledger_line_kind";
  reversed_amount integer;
  reversed_gst integer;
BEGIN
  IF NEW.kind <> 'reversal' THEN
    RETURN NEW;
  END IF;
  SELECT kind, amount_cents, gst_cents INTO reversed_kind, reversed_amount, reversed_gst
    FROM "ledger_lines" WHERE id = NEW.reverses_id;
  IF reversed_kind = 'reversal' THEN
    RAISE EXCEPTION 'a reversal cannot be reversed' USING ERRCODE = 'check_violation';
  END IF;
  IF reversed_amount <> NEW.amount_cents OR reversed_gst <> NEW.gst_cents THEN
    RAISE EXCEPTION 'a reversal must be for the amount and GST it undoes' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "ledger_lines_reversal_checked"
  BEFORE INSERT ON "ledger_lines"
  FOR EACH ROW EXECUTE FUNCTION "app"."check_ledger_reversal"();--> statement-breakpoint

-- The ledger is a history (rule 11): added to, never changed or removed.
CREATE TRIGGER "ledger_lines_append_only"
  BEFORE UPDATE OR DELETE ON "ledger_lines"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "ledger_lines_no_truncate"
  BEFORE TRUNCATE ON "ledger_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "charge_types_no_delete"
  BEFORE DELETE ON "charge_types"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "charge_types_no_truncate"
  BEFORE TRUNCATE ON "charge_types"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint

-- The business's own, and the Operator app's only: the admin logins get nothing (rule 5).
ALTER TABLE "charge_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "charge_types" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "charge_types" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("name", "gst_treatment", "archived_at", "updated_at") ON "charge_types" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "charge_types_web_tenant" ON "charge_types" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
ALTER TABLE "ledger_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ledger_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "ledger_lines" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "ledger_lines_web_tenant" ON "ledger_lines" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());
--> statement-breakpoint

-- The daily rent job has no session (rule 3): it asks which businesses have a
-- rental to charge or credit, then works one business at a time in its own
-- tenant context. Only ids cross between businesses here.
--
-- It runs as the migration owner (SECURITY DEFINER), so the owner gets a read
-- policy on rentals, as for files in 0007: the owner owns the table and could
-- disable row-level security anyway, so this exposes nothing new. The
-- Operator app's role may only call the function.
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY "rentals_owner_rent_lookup" ON "rentals" FOR SELECT TO %I USING (true)',
    current_user
  );
END
$$;--> statement-breakpoint
CREATE FUNCTION "app"."operators_with_rent_due"(
  "returned_since" timestamp with time zone
) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT DISTINCT "operator_id" FROM "public"."rentals"
  WHERE "status" = 'active'
     OR ("status" IN ('returned', 'closed') AND "returned_at" >= "returned_since")
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."operators_with_rent_due"(timestamp with time zone) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."operators_with_rent_due"(timestamp with time zone) TO "web_app_role";
