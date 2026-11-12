-- One-off charges: always told, then a notice period before any debit
-- (docs/plans/one-off-charge-notice.md, approved by Abhi on 12 Nov 2026,
-- 3 days' notice; review fixes 13 Nov 2026). Every one-off charge gets its
-- own invoice, emailed to the Renter at once. When that email states how the
-- charge will be debited, a notice is recorded (debit_notices: the plan and
-- weeks it stated, its first debit day, and the parts already debited), and
-- the plan points at it. A notice covers exactly the plan it stated: any
-- change of plan or weeks voids it here, in the database. A part is debited
-- only inside its notice's window (from its date to 7 days after the week it
-- falls in, NOTICE_LAPSE_DAYS in packages/core/src/one-off-notice.ts); once
-- that passes, a new notice is needed.
--
-- Safe with the code of 0063 still running: that code never writes a
-- notice, its plan changes still pass (and void nothing, as it has none),
-- and a one-off part it tries to debit is refused here (no debit is made,
-- nothing is sent to Stripe; its run alerts AGS for that rental), so nothing
-- is debited without notice in the minutes before the new code is live.
CREATE TABLE "debit_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"rental_id" uuid NOT NULL,
	"debit_plan_id" uuid NOT NULL,
	"plan" "debit_collection_plan" NOT NULL,
	"weeks" integer,
	"notice_date" date NOT NULL,
	"parts_before" integer NOT NULL,
	"issued_document_id" uuid NOT NULL,
	"given_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "debit_notices_id_plan_unique" UNIQUE("id","operator_id","debit_plan_id"),
	CONSTRAINT "debit_notices_parts_before" CHECK ("debit_notices"."parts_before" >= 0),
	CONSTRAINT "debit_notices_plan" CHECK ("debit_notices"."plan" <> 'not_debited' and ("debit_notices"."plan" = 'split') = ("debit_notices"."weeks" is not null))
);
--> statement-breakpoint
ALTER TABLE "debit_plans" ADD COLUMN "notice_id" uuid;--> statement-breakpoint
ALTER TABLE "debit_plans" ADD CONSTRAINT "debit_plans_id_operator_unique" UNIQUE("id","operator_id");--> statement-breakpoint
ALTER TABLE "debit_notices" ADD CONSTRAINT "debit_notices_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_notices" ADD CONSTRAINT "debit_notices_given_by_user_id_users_id_fk" FOREIGN KEY ("given_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_notices" ADD CONSTRAINT "debit_notices_rental_fk" FOREIGN KEY ("rental_id","operator_id") REFERENCES "public"."rentals"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_notices" ADD CONSTRAINT "debit_notices_plan_fk" FOREIGN KEY ("debit_plan_id","operator_id") REFERENCES "public"."debit_plans"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_notices" ADD CONSTRAINT "debit_notices_document_fk" FOREIGN KEY ("issued_document_id","operator_id") REFERENCES "public"."issued_documents"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "debit_notices_plan_idx" ON "debit_notices" USING btree ("operator_id","debit_plan_id");--> statement-breakpoint
ALTER TABLE "debit_plans" ADD CONSTRAINT "debit_plans_notice_fk" FOREIGN KEY ("notice_id","operator_id","id") REFERENCES "public"."debit_notices"("id","operator_id","debit_plan_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint--> statement-breakpoint

-- Notices are records: only ever added (rule 13; kept with the money records).
CREATE TRIGGER "debit_notices_append_only"
  BEFORE UPDATE OR DELETE ON "debit_notices"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "debit_notices_no_truncate"
  BEFORE TRUNCATE ON "debit_notices"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint

-- A notice states the plan's terms as they are when it is recorded, counts
-- the parts already debited, and gives at least the rental's notice period
-- from the day it is recorded on the business's calendar (the rental's
-- settings copy; never under the platform minimum of 3 days).
CREATE FUNCTION "app"."check_debit_notice"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  planned "debit_plans"%ROWTYPE;
  earliest date;
BEGIN
  SELECT * INTO planned FROM "debit_plans" WHERE "id" = NEW.debit_plan_id;
  SELECT ("now"() AT TIME ZONE "o"."timezone")::date + greatest(
      coalesce(("r"."settings_snapshot" ->> 'oneOffNoticeDays')::integer, 3), 3)
    INTO earliest
    FROM "rentals" "r" JOIN "operators" "o" ON "o"."id" = "r"."operator_id"
    WHERE "r"."id" = planned.rental_id;
  IF planned.id IS NULL OR NEW.rental_id IS DISTINCT FROM planned.rental_id
    OR NEW.plan IS DISTINCT FROM planned.plan OR NEW.weeks IS DISTINCT FROM planned.weeks THEN
    RAISE EXCEPTION 'a notice states its plan as it is' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.parts_before <> (SELECT count(*) FROM "debit_items" WHERE "ledger_line_id" = planned.ledger_line_id) THEN
    RAISE EXCEPTION 'a notice counts the parts already debited' USING ERRCODE = 'check_violation';
  END IF;
  IF earliest IS NULL OR NEW.notice_date < earliest THEN
    RAISE EXCEPTION 'a notice gives the full notice period' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "debit_notices_checked"
  BEFORE INSERT ON "debit_notices"
  FOR EACH ROW EXECUTE FUNCTION "app"."check_debit_notice"();--> statement-breakpoint

-- A one-off charge's plan is for a charge of its own rental, and changes
-- only until any part of it is in a debit. It starts with no notice; it may
-- point at a notice of its own (the link's key makes sure of that) stating
-- exactly its plan and weeks; and any change of plan or weeks voids its
-- notice, so a changed plan is never debited on the old one's email.
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
    IF NEW.notice_id IS NOT NULL THEN
      RAISE EXCEPTION 'a plan gets its notice once its invoice is emailed'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.ledger_line_id IS DISTINCT FROM OLD.ledger_line_id
    OR NEW.rental_id IS DISTINCT FROM OLD.rental_id
    OR NEW.operator_id IS DISTINCT FROM OLD.operator_id THEN
    RAISE EXCEPTION 'a debit plan stays with its charge' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.plan IS DISTINCT FROM OLD.plan OR NEW.weeks IS DISTINCT FROM OLD.weeks THEN
    IF EXISTS (SELECT 1 FROM "debit_items" WHERE "ledger_line_id" = OLD.ledger_line_id) THEN
      RAISE EXCEPTION 'a charge already in a debit keeps how it is collected'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.notice_id := NULL;
    RETURN NEW;
  END IF;
  IF NEW.notice_id IS NOT NULL AND NEW.notice_id IS DISTINCT FROM OLD.notice_id AND NOT EXISTS (
    SELECT 1 FROM "debit_notices"
    WHERE "id" = NEW.notice_id AND "plan" = NEW.plan AND "weeks" IS NOT DISTINCT FROM NEW.weeks
  ) THEN
    RAISE EXCEPTION 'a plan''s notice states its plan' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- A debit's item is a charge of its rental, in a debit (never a bond). A
-- one-off part (a charge for no rent period) needs its plan's current
-- notice, stating that plan, to cover the part and the debit's day on the
-- business's calendar: from the notice's date to 7 days after the week the
-- part falls in. A one-off debit is never dated ahead of now, so the window
-- can't be met by a debit dated in the future.
CREATE OR REPLACE FUNCTION "app"."check_debit_item"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  charge "ledger_lines"%ROWTYPE;
  debit_day date;
  requested timestamptz;
  given "debit_notices"%ROWTYPE;
  weeks_in integer;
BEGIN
  SELECT * INTO charge FROM "ledger_lines" WHERE "id" = NEW.ledger_line_id;
  SELECT ("p"."requested_at" AT TIME ZONE "o"."timezone")::date, "p"."requested_at"
    INTO debit_day, requested
    FROM "payments" "p" JOIN "operators" "o" ON "o"."id" = "p"."operator_id"
    WHERE "p"."id" = NEW.payment_id AND "p"."purpose"::text <> 'bond';
  IF debit_day IS NULL OR charge.id IS NULL OR charge.kind <> 'charge' THEN
    RAISE EXCEPTION 'a debit item is a charge in a debit' USING ERRCODE = 'check_violation';
  END IF;
  IF charge.period_start IS NOT NULL OR charge.period_starts_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  SELECT "n".* INTO given FROM "debit_plans" "d"
    JOIN "debit_notices" "n" ON "n"."id" = "d"."notice_id"
    WHERE "d"."ledger_line_id" = NEW.ledger_line_id
      AND "n"."plan" = "d"."plan" AND "n"."weeks" IS NOT DISTINCT FROM "d"."weeks";
  weeks_in := NEW.instalment - 1 - given.parts_before;
  IF given.id IS NULL OR weeks_in < 0 OR requested > "now"()
    OR debit_day < given.notice_date
    OR debit_day > given.notice_date + weeks_in * 7 + 7 THEN
    RAISE EXCEPTION 'a one-off charge is debited only inside the notice the Renter was emailed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint

-- The business's own, and the Operator app's only (rule 5). The web login
-- may change a plan's notice link only through the rules above.
ALTER TABLE "debit_notices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "debit_notices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "debit_notices" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "debit_notices_web_tenant" ON "debit_notices" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
GRANT UPDATE ("notice_id") ON "debit_plans" TO "web_app_role";--> statement-breakpoint

-- Owner read policies for the SECURITY DEFINER lookups below, as for
-- payments in 0063.
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
  EXECUTE format(
    'CREATE POLICY "debit_notices_owner_lookup" ON "debit_notices" FOR SELECT TO %I USING (true)',
    current_user
  );
END
$$;--> statement-breakpoint

-- The businesses with debits to do tonight (Operator IDs only, rule 3), as
-- in 0063, and also one with a noticed one-off charge with parts left (a
-- "Debit on [date]" charge may be on a rental already returned).
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
  WHERE "d"."notice_id" IS NOT NULL
    AND "o"."suspended_at" IS NULL AND "a"."disconnected_at" IS NULL
    AND "a"."becs_debit_payments" = 'active'
    AND (SELECT count(*) FROM "public"."debit_items" "i"
      WHERE "i"."ledger_line_id" = "d"."ledger_line_id") < coalesce("d"."weeks", 1)
$$;--> statement-breakpoint

-- The businesses with a one-off charge planned for a debit, with parts left,
-- not reversed, on a rental still open for money, whose Renter has no
-- current notice for it: none yet, voided by a change of plan, or lapsed
-- (its next part's window has passed). Tonight's notice run tells them when
-- the debit could be made. Operator IDs only (rule 3).
CREATE FUNCTION "app"."operators_with_charge_notices_due"() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT DISTINCT "d"."operator_id" FROM "public"."debit_plans" "d"
    JOIN "public"."rentals" "r" ON "r"."id" = "d"."rental_id"
    JOIN "public"."operators" "o" ON "o"."id" = "d"."operator_id"
    LEFT JOIN "public"."debit_notices" "n" ON "n"."id" = "d"."notice_id"
  WHERE "d"."plan"::text <> 'not_debited'
    AND "r"."status" IN ('booked', 'active', 'returned')
    AND NOT EXISTS (SELECT 1 FROM "public"."ledger_lines" "l"
      WHERE "l"."reverses_id" = "d"."ledger_line_id")
    AND (SELECT count(*) FROM "public"."debit_items" "i"
      WHERE "i"."ledger_line_id" = "d"."ledger_line_id") < coalesce("d"."weeks", 1)
    AND ("n"."id" IS NULL OR ("now"() AT TIME ZONE "o"."timezone")::date > "n"."notice_date"
      + ((SELECT count(*) FROM "public"."debit_items" "i"
        WHERE "i"."ledger_line_id" = "d"."ledger_line_id")::integer - "n"."parts_before") * 7 + 7)
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
