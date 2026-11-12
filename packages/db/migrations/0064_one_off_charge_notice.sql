-- One-off charges: always told, then a notice period before any debit
-- (docs/plans/one-off-charge-notice.md, approved by Abhi on 12 Nov 2026,
-- 3 days' notice). Every one-off charge gets its own invoice, emailed to the
-- Renter at once; its plan's notice date is set when that email (stating the
-- debit) is recorded as sent, and no part of it is debited before that day.
--
-- Safe with the code of 0063 still running: that code never writes
-- notice_date, its plan changes (plan, weeks, who chose it) still pass, and a
-- one-off part it tries to debit is refused here (no debit is made, nothing
-- is sent to Stripe; its run alerts AGS for that rental), so nothing is
-- debited without notice in the minutes before the new code is live. Its
-- weekly rent is debited by the new code's run, inside the 7 days.
ALTER TABLE "debit_plans" ADD COLUMN "notice_date" date;--> statement-breakpoint
GRANT UPDATE ("notice_date") ON "debit_plans" TO "web_app_role";--> statement-breakpoint

-- A one-off charge's plan is for a charge of its own rental, and changes
-- only until any part of it is in a debit. Its notice date is set once, from
-- none, and never changed; setting it is the one change allowed once a part
-- is in a debit (a split already part debited when this went live).
CREATE OR REPLACE FUNCTION "app"."check_debit_plan"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ledger_lines" WHERE "id" = NEW.ledger_line_id AND "kind" = 'charge'
  ) THEN
    RAISE EXCEPTION 'a debit plan is for a charge' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.notice_date IS NOT NULL THEN
      RAISE EXCEPTION 'a notice date is set once the invoice is emailed'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.ledger_line_id IS DISTINCT FROM OLD.ledger_line_id
    OR NEW.rental_id IS DISTINCT FROM OLD.rental_id
    OR NEW.operator_id IS DISTINCT FROM OLD.operator_id THEN
    RAISE EXCEPTION 'a debit plan stays with its charge' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.notice_date IS NOT NULL AND NEW.notice_date IS DISTINCT FROM OLD.notice_date THEN
    RAISE EXCEPTION 'a notice date, once given, never changes' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.plan IS DISTINCT FROM OLD.plan OR NEW.weeks IS DISTINCT FROM OLD.weeks)
    AND EXISTS (SELECT 1 FROM "debit_items" WHERE "ledger_line_id" = OLD.ledger_line_id) THEN
    RAISE EXCEPTION 'a charge already in a debit keeps how it is collected'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- A debit's item is a charge of its rental, in a debit (never a bond). A
-- one-off part (a charge for no rent period) needs a plan whose notice date
-- has come by the debit's day on the business's calendar: no email, no
-- debit, and never early, whatever a code mistake asks for.
CREATE OR REPLACE FUNCTION "app"."check_debit_item"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  charge "ledger_lines"%ROWTYPE;
  debit_day date;
BEGIN
  SELECT * INTO charge FROM "ledger_lines" WHERE "id" = NEW.ledger_line_id;
  SELECT ("p"."requested_at" AT TIME ZONE "o"."timezone")::date INTO debit_day
    FROM "payments" "p" JOIN "operators" "o" ON "o"."id" = "p"."operator_id"
    WHERE "p"."id" = NEW.payment_id AND "p"."purpose"::text <> 'bond';
  IF debit_day IS NULL OR charge.id IS NULL OR charge.kind <> 'charge' THEN
    RAISE EXCEPTION 'a debit item is a charge in a debit' USING ERRCODE = 'check_violation';
  END IF;
  IF charge.period_start IS NULL AND charge.period_starts_at IS NULL AND NOT EXISTS (
    SELECT 1 FROM "debit_plans"
    WHERE "ledger_line_id" = NEW.ledger_line_id
      AND "notice_date" IS NOT NULL AND "notice_date" <= debit_day
  ) THEN
    RAISE EXCEPTION 'a one-off charge is debited only once its notice date has come'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint

-- The businesses with debits to do tonight (Operator IDs only, rule 3), as
-- in 0063, and also one with a one-off charge planned for a debit with parts
-- still to take (a "Debit on [date]" charge may be on a rental already
-- returned). The owner gets read policies on plans and items for this
-- SECURITY DEFINER function, as for payments in 0063.
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY "debit_plans_owner_lookup" ON "debit_plans" FOR SELECT TO %I USING (true)',
    current_user
  );
  EXECUTE format(
    'CREATE POLICY "debit_items_owner_lookup" ON "debit_items" FOR SELECT TO %I USING (true)',
    current_user
  );
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app"."operators_with_debits_due"() RETURNS SETOF uuid
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
  UNION
  SELECT DISTINCT "d"."operator_id" FROM "public"."debit_plans" "d"
    JOIN "public"."operators" "o" ON "o"."id" = "d"."operator_id"
    JOIN "public"."stripe_accounts" "a" ON "a"."operator_id" = "d"."operator_id"
  WHERE "d"."plan"::text <> 'not_debited' AND "d"."notice_date" IS NOT NULL
    AND "o"."suspended_at" IS NULL AND "a"."disconnected_at" IS NULL
    AND "a"."becs_debit_payments" = 'active'
    AND (SELECT count(*) FROM "public"."debit_items" "i"
      WHERE "i"."ledger_line_id" = "d"."ledger_line_id") < coalesce("d"."weeks", 1)
$$;--> statement-breakpoint

-- The businesses with a one-off charge planned for a debit whose Renter has
-- not been told yet (no notice date) on a rental still open for money:
-- tonight's catch-up issues and emails its invoice if that was never tried
-- (the charges already planned when this went live, or a send cut short).
-- Operator IDs only (rule 3).
CREATE FUNCTION "app"."operators_with_charge_notices_due"() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT DISTINCT "d"."operator_id" FROM "public"."debit_plans" "d"
    JOIN "public"."rentals" "r" ON "r"."id" = "d"."rental_id"
  WHERE "d"."plan"::text <> 'not_debited' AND "d"."notice_date" IS NULL
    AND "r"."status" IN ('booked', 'active', 'returned')
    AND NOT EXISTS (SELECT 1 FROM "public"."ledger_lines" "l"
      WHERE "l"."reverses_id" = "d"."ledger_line_id")
    AND (SELECT count(*) FROM "public"."debit_items" "i"
      WHERE "i"."ledger_line_id" = "d"."ledger_line_id") < coalesce("d"."weeks", 1)
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."operators_with_charge_notices_due"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."operators_with_charge_notices_due"() TO "web_app_role";--> statement-breakpoint

-- Every open rental whose settings copy put one-off charges on the next
-- weekly invoice (or predates the choice, whose default was that) now has
-- them invoiced at once: an explicit change to its terms, logged once here
-- (rule 14; the copy itself never changes). The actor is the system.
INSERT INTO "activity_log" ("operator_id", "actor_type", "actor_id", "entity_type", "entity_id", "action", "values_before", "values_after")
  SELECT "operator_id", 'system', NULL, 'rental', "id", 'updated',
    jsonb_build_object('oneOffChargeInvoicing', 'with_next_rent'),
    jsonb_build_object('oneOffChargeInvoicing', 'own_invoice',
      'reason', 'One-off charges are always invoiced and emailed at once (one-off charge notice, 12 Nov 2026)')
  FROM "rentals"
  WHERE "status" IN ('draft', 'booked', 'active', 'returned')
    AND coalesce("settings_snapshot" ->> 'oneOffChargeInvoicing', 'with_next_rent') <> 'own_invoice';
