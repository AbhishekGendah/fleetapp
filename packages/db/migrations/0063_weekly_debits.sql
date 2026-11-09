-- Weekly debits (docs/plans/phase-4-slice-5.md, approved by Abhi on 9 Nov
-- 2026): the business asks Stripe for each rent week (and a one-off charge
-- when it chooses) under the Renter's direct debit. A debit is a payments
-- row, reserved before Stripe is asked; what it was planned from is in
-- debit_items; which ledger lines Stripe's news made is in
-- payment_ledger_lines; how a one-off charge is collected is in
-- debit_plans; a rental's automatic debits can be paused.
--
-- Safe with the code of 0062 still running: that code never makes a debit
-- row, and its bond inserts (a Checkout session and a PaymentIntent, no
-- direct debit, week or request time) and status updates all pass the new
-- rules. The new purposes are added here, and Drizzle runs every waiting
-- update in one transaction, where a new enum value can't be used: checks
-- compare "purpose"::text, and no index or function uses the new values
-- (a partial index may not compare purpose::text at all, so the one-per-week
-- index keys on the week column instead).
CREATE TYPE "public"."debit_collection_plan" AS ENUM('not_debited', 'next_debit', 'own_debit', 'split');--> statement-breakpoint
CREATE TYPE "public"."payment_line_reason" AS ENUM('settled', 'refund', 'refund_failed', 'dispute_lost', 'dispute_won');--> statement-breakpoint
ALTER TYPE "public"."payment_purpose" ADD VALUE 'scheduled_debit';--> statement-breakpoint
ALTER TYPE "public"."payment_purpose" ADD VALUE 'one_off_debit';--> statement-breakpoint
CREATE TABLE "debit_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"rental_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"ledger_line_id" uuid NOT NULL,
	"instalment" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "debit_items_one_per_part" UNIQUE("ledger_line_id","instalment"),
	CONSTRAINT "debit_items_instalment" CHECK ("debit_items"."instalment" >= 1),
	CONSTRAINT "debit_items_amount" CHECK ("debit_items"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "debit_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"rental_id" uuid NOT NULL,
	"ledger_line_id" uuid NOT NULL,
	"plan" "debit_collection_plan" NOT NULL,
	"weeks" integer,
	"chosen_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "debit_plans_ledger_line_id_unique" UNIQUE("ledger_line_id"),
	CONSTRAINT "debit_plans_weeks" CHECK (("debit_plans"."plan" = 'split') = ("debit_plans"."weeks" is not null)
        and ("debit_plans"."weeks" is null or "debit_plans"."weeks" between 2 and 12))
);
--> statement-breakpoint
CREATE TABLE "payment_ledger_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"rental_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"ledger_line_id" uuid NOT NULL,
	"reason" "payment_line_reason" NOT NULL,
	"stripe_object_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_ledger_lines_ledger_line_id_unique" UNIQUE("ledger_line_id"),
	CONSTRAINT "payment_ledger_lines_once_per_object" UNIQUE("stripe_object_id","reason"),
	CONSTRAINT "payment_ledger_lines_object" CHECK (("payment_ledger_lines"."reason" = 'settled') = ("payment_ledger_lines"."stripe_object_id" is null)
        and ("payment_ledger_lines"."stripe_object_id" is null or "payment_ledger_lines"."stripe_object_id" ~ '^[a-z]+_[A-Za-z0-9]+$'))
);
--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_id_shapes";--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "stripe_checkout_session_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "stripe_payment_intent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "debits_paused_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "debits_paused_reason" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "mandate_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "period_starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "attempt" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "stripe_fee_cents" integer;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "debit_items" ADD CONSTRAINT "debit_items_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_items" ADD CONSTRAINT "debit_items_rental_fk" FOREIGN KEY ("rental_id","operator_id") REFERENCES "public"."rentals"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_items" ADD CONSTRAINT "debit_items_payment_fk" FOREIGN KEY ("payment_id","operator_id","rental_id") REFERENCES "public"."payments"("id","operator_id","rental_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_items" ADD CONSTRAINT "debit_items_ledger_line_fk" FOREIGN KEY ("ledger_line_id","operator_id","rental_id") REFERENCES "public"."ledger_lines"("id","operator_id","rental_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_plans" ADD CONSTRAINT "debit_plans_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_plans" ADD CONSTRAINT "debit_plans_chosen_by_user_id_users_id_fk" FOREIGN KEY ("chosen_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_plans" ADD CONSTRAINT "debit_plans_rental_fk" FOREIGN KEY ("rental_id","operator_id") REFERENCES "public"."rentals"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_plans" ADD CONSTRAINT "debit_plans_ledger_line_fk" FOREIGN KEY ("ledger_line_id","operator_id","rental_id") REFERENCES "public"."ledger_lines"("id","operator_id","rental_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_ledger_lines" ADD CONSTRAINT "payment_ledger_lines_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_ledger_lines" ADD CONSTRAINT "payment_ledger_lines_rental_fk" FOREIGN KEY ("rental_id","operator_id") REFERENCES "public"."rentals"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_ledger_lines" ADD CONSTRAINT "payment_ledger_lines_payment_fk" FOREIGN KEY ("payment_id","operator_id","rental_id") REFERENCES "public"."payments"("id","operator_id","rental_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_ledger_lines" ADD CONSTRAINT "payment_ledger_lines_ledger_line_fk" FOREIGN KEY ("ledger_line_id","operator_id","rental_id") REFERENCES "public"."ledger_lines"("id","operator_id","rental_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "debit_items_payment_idx" ON "debit_items" USING btree ("operator_id","payment_id");--> statement-breakpoint
CREATE INDEX "debit_plans_rental_idx" ON "debit_plans" USING btree ("operator_id","rental_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_ledger_lines_one_settled" ON "payment_ledger_lines" USING btree ("payment_id") WHERE "payment_ledger_lines"."reason" = 'settled';--> statement-breakpoint
CREATE INDEX "payment_ledger_lines_payment_idx" ON "payment_ledger_lines" USING btree ("operator_id","payment_id");--> statement-breakpoint
ALTER TABLE "payment_mandates" ADD CONSTRAINT "payment_mandates_id_renter_unique" UNIQUE("id","renter_id","operator_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_mandate_fk" FOREIGN KEY ("mandate_id","renter_id","operator_id") REFERENCES "public"."payment_mandates"("id","renter_id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_debit_per_week" ON "payments" USING btree ("operator_id","rental_id","period_starts_at","attempt") WHERE "payments"."period_starts_at" is not null;--> statement-breakpoint
CREATE INDEX "payments_reserved_idx" ON "payments" USING btree ("operator_id","requested_at") WHERE "payments"."stripe_payment_intent_id" is null and "payments"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_debits_paused" CHECK (("rentals"."debits_paused_at" is null) = ("rentals"."debits_paused_reason" is null)
        and ("rentals"."debits_paused_reason" is null or length(trim("rentals"."debits_paused_reason")) > 0));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_purpose_details" CHECK (("payments"."purpose"::text = 'bond') = ("payments"."stripe_checkout_session_id" is not null)
        and ("payments"."purpose"::text = 'bond') = ("payments"."mandate_id" is null)
        and ("payments"."purpose"::text = 'bond') = ("payments"."requested_at" is null)
        and ("payments"."purpose"::text = 'scheduled_debit') = ("payments"."period_starts_at" is not null)
        and ("payments"."purpose"::text = 'bond' or "payments"."method" = 'becs_debit'));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_intent_known" CHECK ("payments"."stripe_payment_intent_id" is not null
        or ("payments"."purpose"::text <> 'bond' and "payments"."status" in ('pending', 'failed')));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_attempt" CHECK ("payments"."attempt" >= 1);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_fee" CHECK ("payments"."stripe_fee_cents" is null or "payments"."stripe_fee_cents" >= 0);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_id_shapes" CHECK (("payments"."stripe_checkout_session_id" is null or "payments"."stripe_checkout_session_id" ~ '^cs_[A-Za-z0-9_]+$')
        and ("payments"."stripe_payment_intent_id" is null or "payments"."stripe_payment_intent_id" ~ '^pi_[A-Za-z0-9]+$'));--> statement-breakpoint

-- A payment's amount, method, purpose, rental, Renter, direct debit, week
-- and attempt never change; Stripe's IDs and fee are filled once and never
-- changed; its status only moves forward, as Stripe reports it: pending to
-- succeeded or failed, and succeeded to refunded (as in 0041). The one way
-- back: a debit we marked "not sent" (recovery found none at Stripe) that
-- Stripe then says was made and succeeded, so money taken is never left
-- unrecorded.
CREATE OR REPLACE FUNCTION "app"."check_payment_change"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.operator_id IS DISTINCT FROM OLD.operator_id
    OR NEW.renter_id IS DISTINCT FROM OLD.renter_id
    OR NEW.rental_id IS DISTINCT FROM OLD.rental_id
    OR NEW.purpose IS DISTINCT FROM OLD.purpose
    OR NEW.method IS DISTINCT FROM OLD.method
    OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
    OR NEW.mandate_id IS DISTINCT FROM OLD.mandate_id
    OR NEW.period_starts_at IS DISTINCT FROM OLD.period_starts_at
    OR NEW.attempt IS DISTINCT FROM OLD.attempt
    OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
    OR NEW.stripe_checkout_session_id IS DISTINCT FROM OLD.stripe_checkout_session_id THEN
    RAISE EXCEPTION 'a payment''s amount, method and what it is for never change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (OLD.stripe_payment_intent_id IS NOT NULL
      AND NEW.stripe_payment_intent_id IS DISTINCT FROM OLD.stripe_payment_intent_id)
    OR (OLD.stripe_fee_cents IS NOT NULL
      AND NEW.stripe_fee_cents IS DISTINCT FROM OLD.stripe_fee_cents) THEN
    RAISE EXCEPTION 'Stripe''s payment ID and fee are set once, never changed'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT (
    (OLD.status = 'pending' AND NEW.status IN ('succeeded', 'failed'))
    OR (OLD.status = 'succeeded' AND NEW.status = 'refunded')
    OR (OLD.status = 'failed' AND OLD.failure_code = 'not_sent' AND NEW.status = 'succeeded')
  ) THEN
    RAISE EXCEPTION 'a payment cannot go from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- A one-off charge's plan is for a charge of its own rental, and changes
-- only until any part of it is in a debit.
CREATE FUNCTION "app"."check_debit_plan"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ledger_lines" WHERE "id" = NEW.ledger_line_id AND "kind" = 'charge'
  ) THEN
    RAISE EXCEPTION 'a debit plan is for a charge' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.ledger_line_id IS DISTINCT FROM OLD.ledger_line_id
      OR NEW.rental_id IS DISTINCT FROM OLD.rental_id
      OR NEW.operator_id IS DISTINCT FROM OLD.operator_id THEN
      RAISE EXCEPTION 'a debit plan stays with its charge' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM "debit_items" WHERE "ledger_line_id" = OLD.ledger_line_id) THEN
      RAISE EXCEPTION 'a charge already in a debit keeps how it is collected'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "debit_plans_checked"
  BEFORE INSERT OR UPDATE ON "debit_plans"
  FOR EACH ROW EXECUTE FUNCTION "app"."check_debit_plan"();--> statement-breakpoint

-- A debit's item is a charge of its rental, in a debit (never a bond).
CREATE FUNCTION "app"."check_debit_item"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "payments" WHERE "id" = NEW.payment_id AND "purpose"::text <> 'bond'
  ) OR NOT EXISTS (
    SELECT 1 FROM "ledger_lines" WHERE "id" = NEW.ledger_line_id AND "kind" = 'charge'
  ) THEN
    RAISE EXCEPTION 'a debit item is a charge in a debit' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "debit_items_checked"
  AFTER INSERT ON "debit_items"
  FOR EACH ROW EXECUTE FUNCTION "app"."check_debit_item"();--> statement-breakpoint

-- A ledger line made from Stripe's news is of the kind its reason says, for
-- a debit: a payment once it cleared or a dispute was won, a refund for a
-- refund or a dispute lost, a reversal for a refund that failed. One that
-- cleared is for exactly the debit's amount, once the debit succeeded.
CREATE FUNCTION "app"."check_payment_ledger_line"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  paid "payments"%ROWTYPE;
  line "ledger_lines"%ROWTYPE;
BEGIN
  SELECT * INTO paid FROM "payments" WHERE "id" = NEW.payment_id;
  SELECT * INTO line FROM "ledger_lines" WHERE "id" = NEW.ledger_line_id;
  IF paid.purpose::text = 'bond' OR line.kind::text <> (CASE NEW.reason
      WHEN 'settled' THEN 'payment'
      WHEN 'dispute_won' THEN 'payment'
      WHEN 'refund' THEN 'refund'
      WHEN 'dispute_lost' THEN 'refund'
      ELSE 'reversal' END)
    OR (NEW.reason = 'settled' AND (paid.status <> 'succeeded'
      OR line.amount_cents <> paid.amount_cents OR line.method <> paid.method)) THEN
    RAISE EXCEPTION 'a ledger line from Stripe must match its debit' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "payment_ledger_lines_checked"
  AFTER INSERT ON "payment_ledger_lines"
  FOR EACH ROW EXECUTE FUNCTION "app"."check_payment_ledger_line"();--> statement-breakpoint

-- A line Stripe's news made is changed only by Stripe's news (decision 8):
-- a reversal by a person of one would let a dispute later take it back twice.
CREATE FUNCTION "app"."refuse_hand_reversal_of_stripe_line"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.reverses_id IS NOT NULL AND NEW.created_by_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM "payment_ledger_lines" WHERE "ledger_line_id" = NEW.reverses_id
  ) THEN
    RAISE EXCEPTION 'a line from Stripe is changed in Stripe, not reversed by hand'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "ledger_lines_stripe_lines_kept"
  BEFORE INSERT ON "ledger_lines"
  FOR EACH ROW EXECUTE FUNCTION "app"."refuse_hand_reversal_of_stripe_line"();--> statement-breakpoint

-- Records, not drafts: items and links are only ever added; plans are never
-- removed (rule 13; kept as tax records, never touched by retention jobs).
CREATE TRIGGER "debit_items_append_only"
  BEFORE UPDATE OR DELETE ON "debit_items"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "debit_items_no_truncate"
  BEFORE TRUNCATE ON "debit_items"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "payment_ledger_lines_append_only"
  BEFORE UPDATE OR DELETE ON "payment_ledger_lines"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "payment_ledger_lines_no_truncate"
  BEFORE TRUNCATE ON "payment_ledger_lines"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "debit_plans_no_delete"
  BEFORE DELETE ON "debit_plans"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "debit_plans_no_truncate"
  BEFORE TRUNCATE ON "debit_plans"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint

-- The business's own, and the Operator app's only: the admin logins get
-- nothing (rule 5).
ALTER TABLE "debit_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "debit_plans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "debit_plans" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("plan", "weeks", "chosen_by_user_id", "updated_at") ON "debit_plans" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "debit_plans_web_tenant" ON "debit_plans" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
ALTER TABLE "debit_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "debit_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "debit_items" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "debit_items_web_tenant" ON "debit_items" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
ALTER TABLE "payment_ledger_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_ledger_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "payment_ledger_lines" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "payment_ledger_lines_web_tenant" ON "payment_ledger_lines" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
GRANT UPDATE ("stripe_payment_intent_id", "stripe_fee_cents") ON "payments" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("debits_paused_at", "debits_paused_reason") ON "rentals" TO "web_app_role";--> statement-breakpoint

-- The businesses with debits to do tonight (Operator IDs only, rule 3):
-- not suspended (decision 4), with a Stripe account connected that can take
-- BECS debits, and a long-term block rental out; or with a debit of theirs
-- still pending at Stripe, to recover or read again (on an account still
-- connected). As in 0047, the owner gets a read policy on payments so this
-- SECURITY DEFINER function sees them.
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY "payments_owner_debit_lookup" ON "payments" FOR SELECT TO %I USING (true)',
    current_user
  );
END
$$;--> statement-breakpoint
CREATE FUNCTION "app"."operators_with_debits_due"() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT DISTINCT "r"."operator_id" FROM "public"."rentals" "r"
    JOIN "public"."operators" "o" ON "o"."id" = "r"."operator_id"
    JOIN "public"."stripe_accounts" "a" ON "a"."operator_id" = "r"."operator_id"
  WHERE "r"."status" = 'active' AND "r"."rent_model" = 'blocks' AND "r"."is_long_term"
    AND "o"."suspended_at" IS NULL AND "a"."disconnected_at" IS NULL
    AND "a"."becs_debit_payments" = 'active'
  UNION
  SELECT DISTINCT "p"."operator_id" FROM "public"."payments" "p"
    JOIN "public"."stripe_accounts" "a" ON "a"."operator_id" = "p"."operator_id"
  WHERE "p"."status" = 'pending' AND "p"."requested_at" IS NOT NULL
    AND "a"."disconnected_at" IS NULL
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."operators_with_debits_due"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."operators_with_debits_due"() TO "web_app_role";
