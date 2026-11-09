-- Business Renters, slice 4 review (9 Nov 2026, approved by Abhi for these
-- two items only): the reasons typed for a swap or a driver change are
-- cleared with the rest of a retired Renter's free text (APP 11.2), and the
-- database refuses a driver change finishing, or a rental's car coming back,
-- other than as the app does it. Safe with the code deployed before it: that
-- code never clears a reason, never brings a car back while a driver change
-- is under way (a return can't start then), and finishes a change in one
-- transaction that names the new driver and starts their time with the car
-- at the moment the last driver's ends, as the checks below want.

-- The retention job (run as the owner) may change the two tables, within the
-- business it set for its transaction, as in 0047.
DO $$
DECLARE
  "table_name" text;
BEGIN
  FOREACH "table_name" IN ARRAY ARRAY['car_swaps', 'rental_driver_changes'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO %I USING ("operator_id" = "app"."current_operator_id"()) WITH CHECK ("operator_id" = "app"."current_operator_id"())',
      "table_name" || '_owner_retention', "table_name", current_user
    );
  END LOOP;
END
$$;--> statement-breakpoint

-- Whether an update of a finished swap or driver change only clears its
-- reason, as the retention job does (run as the owner): nothing else on it
-- changes, ever.
CREATE FUNCTION "app"."is_reason_retired"("old_row" jsonb, "new_row" jsonb, "rel" oid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT "app"."runs_as_owner"("rel")
    AND "new_row" ->> 'reason' = 'Removed'
    AND ("old_row" - 'reason' - 'updated_at') = ("new_row" - 'reason' - 'updated_at')
$$;--> statement-breakpoint

-- As in 0037 and 0057, except that the retention job may clear the reason.
CREATE OR REPLACE FUNCTION "app"."keep_finished_car_swap"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF OLD.status <> 'in_progress'
      AND NOT "app"."is_reason_retired"(to_jsonb(OLD), to_jsonb(NEW), TG_RELID)
    THEN
      RAISE EXCEPTION 'A % car swap cannot change.', OLD.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app"."keep_finished_driver_change"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF OLD.status <> 'in_progress'
      AND NOT "app"."is_reason_retired"(to_jsonb(OLD), to_jsonb(NEW), TG_RELID)
    THEN
      RAISE EXCEPTION 'A % driver change cannot change.', OLD.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint

-- As in 0053, also clearing the reasons of those rentals' swaps and driver changes.
CREATE OR REPLACE FUNCTION "app"."retire_renter"("target" uuid) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  DECLARE
    "operator" uuid := "app"."current_operator_id"();
  BEGIN
    IF "operator" IS NULL THEN
      RAISE EXCEPTION 'No business is set for this run.' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT "app"."lock_renter_for_retirement"("target") THEN
      RETURN false;
    END IF;
    IF "app"."is_renter_in_use"("target") OR "app"."renter_records_kept_until"("target") > now() THEN
      RETURN false;
    END IF;

    -- Marked retired first: the protections above allow the rest only for a
    -- retired Renter, and the rentals cleared below count them as retired.
    UPDATE "public"."renters" SET
      "full_name" = 'Removed Renter', "preferred_name" = NULL, "date_of_birth" = NULL,
      "phone" = NULL, "email" = NULL, "residential_address" = NULL, "postal_address" = NULL,
      "emergency_contact_name" = NULL, "emergency_contact_phone" = NULL,
      "emergency_contact_relationship" = NULL,
      "licence_issued_in" = NULL, "licence_country" = NULL, "licence_number" = NULL,
      "licence_class" = NULL, "licence_type" = NULL, "licence_expires_on" = NULL,
      "trading_name" = NULL, "abn" = NULL, "contact_name" = NULL, "business_address" = NULL,
      "status" = 'active', "do_not_rent_reason" = NULL,
      "retired_at" = now(), "archived_at" = coalesce("archived_at", now()), "updated_at" = now()
    WHERE "id" = "target" AND "operator_id" = "operator";

    -- Then their files (and the small copies of them), binned now and
    -- removed for good by the usual clean-up 30 days later. Binned before
    -- anything is unlinked, so no "one live photo per side" rule can clash.
    WITH "cleared" AS (
      SELECT "id" FROM "app"."rentals_cleared_with"("target") AS "cleared"("id")
    ), "theirs" AS (
      SELECT "id" FROM "public"."files"
      WHERE "operator_id" = "operator" AND (
        "renter_id" = "target"
        OR "renter_link_id" IN (
          SELECT "id" FROM "public"."renter_links" WHERE "renter_id" = "target" AND "operator_id" = "operator")
        OR "inspection_id" IN (
          SELECT "i"."id" FROM "public"."inspections" "i"
          WHERE "i"."operator_id" = "operator" AND "i"."rental_id" IN (SELECT "id" FROM "cleared"))
        OR "damage_record_id" IN (
          SELECT "id" FROM "public"."damage_records" WHERE "renter_id" = "target" AND "operator_id" = "operator")
        OR "id" IN (
          SELECT "doc"."file_id" FROM "public"."issued_documents" "doc"
          WHERE "doc"."operator_id" = "operator" AND "doc"."rental_id" IN (SELECT "id" FROM "cleared"))
      )
    )
    UPDATE "public"."files" SET "deleted_at" = now()
    WHERE "operator_id" = "operator" AND "deleted_at" IS NULL
      AND ("id" IN (SELECT "id" FROM "theirs") OR "thumbnail_of_file_id" IN (SELECT "id" FROM "theirs"));

    DELETE FROM "public"."renter_notes" WHERE "renter_id" = "target" AND "operator_id" = "operator";
    UPDATE "public"."files" SET "submission_id" = NULL
    WHERE "operator_id" = "operator" AND "submission_id" IN (
      SELECT "id" FROM "public"."renter_submissions" WHERE "renter_id" = "target" AND "operator_id" = "operator"
    );
    DELETE FROM "public"."renter_submissions" WHERE "renter_id" = "target" AND "operator_id" = "operator";
    DELETE FROM "public"."renter_link_devices" WHERE "operator_id" = "operator" AND "link_id" IN (
      SELECT "id" FROM "public"."renter_links" WHERE "renter_id" = "target" AND "operator_id" = "operator"
    );
    DELETE FROM "public"."renter_link_attempts" WHERE "operator_id" = "operator" AND "link_id" IN (
      SELECT "id" FROM "public"."renter_links" WHERE "renter_id" = "target" AND "operator_id" = "operator"
    );
    DELETE FROM "public"."signing_evidence" WHERE "operator_id" = "operator" AND "link_id" IN (
      SELECT "id" FROM "public"."renter_links" WHERE "renter_id" = "target" AND "operator_id" = "operator"
    );
    UPDATE "public"."renter_links" SET
      "sent_to_email" = 'removed', "code_hash" = NULL, "code_expires_at" = NULL,
      "cancelled_at" = coalesce("cancelled_at", now()), "updated_at" = now()
    WHERE "renter_id" = "target" AND "operator_id" = "operator";

    -- Free text the business typed that may name them. Kept non-empty where
    -- a rule needs it there (a cancelled booking's reason, a waiver).
    UPDATE "public"."rentals" SET
      "notes" = NULL,
      "cancellation_reason" = CASE WHEN "cancellation_reason" IS NULL THEN NULL ELSE 'Removed' END,
      "daily_rate_waived_reason" = CASE WHEN "daily_rate_waived_reason" IS NULL THEN NULL ELSE 'Removed' END,
      "updated_at" = now()
    WHERE "operator_id" = "operator" AND "id" IN (SELECT * FROM "app"."rentals_cleared_with"("target"));
    UPDATE "public"."inspections" SET
      "typed_name" = CASE WHEN "typed_name" IS NULL THEN NULL ELSE 'Removed' END,
      "notes" = NULL, "accessories" = NULL,
      "bond_override_reason" = CASE WHEN "bond_override_reason" IS NULL THEN NULL ELSE 'Removed' END,
      "direct_debit_override_reason" = CASE WHEN "direct_debit_override_reason" IS NULL THEN NULL ELSE 'Removed' END,
      "insurance_override_reason" = CASE WHEN "insurance_override_reason" IS NULL THEN NULL ELSE 'Removed' END,
      "rego_override_reason" = CASE WHEN "rego_override_reason" IS NULL THEN NULL ELSE 'Removed' END
    WHERE "operator_id" = "operator" AND "rental_id" IN (SELECT * FROM "app"."rentals_cleared_with"("target"));
    -- Why a swap or a driver change was made: the business's own words,
    -- which may name them. Kept non-empty, as the rule there needs.
    UPDATE "public"."car_swaps" SET "reason" = 'Removed', "updated_at" = now()
    WHERE "operator_id" = "operator" AND "reason" <> 'Removed'
      AND "rental_id" IN (SELECT * FROM "app"."rentals_cleared_with"("target"));
    UPDATE "public"."rental_driver_changes" SET "reason" = 'Removed', "updated_at" = now()
    WHERE "operator_id" = "operator" AND "reason" <> 'Removed'
      AND "rental_id" IN (SELECT * FROM "app"."rentals_cleared_with"("target"));
    UPDATE "public"."inspection_damage_marks" SET "description" = 'Removed'
    WHERE "operator_id" = "operator" AND "inspection_id" IN (
      SELECT "i"."id" FROM "public"."inspections" "i"
      WHERE "i"."operator_id" = "operator"
        AND "i"."rental_id" IN (SELECT * FROM "app"."rentals_cleared_with"("target"))
    );
    UPDATE "public"."damage_records" SET
      "description" = 'Removed',
      "status_note" = CASE WHEN "status_note" IS NULL THEN NULL ELSE 'Removed' END,
      "updated_at" = now()
    WHERE "renter_id" = "target" AND "operator_id" = "operator";
    UPDATE "public"."insurance_claims" SET "notes" = NULL, "updated_at" = now()
    WHERE "operator_id" = "operator" AND "damage_record_id" IN (
      SELECT "id" FROM "public"."damage_records" WHERE "renter_id" = "target" AND "operator_id" = "operator"
    );
    RETURN true;
  END;
$$;--> statement-breakpoint

-- A driver change is completed only as the app completes it, in the one
-- transaction: both its checklists finished, the last driver's time with
-- the car ended at its check-in and the new driver's started from its
-- handover at that same moment, and the rental naming the new driver.
CREATE FUNCTION "app"."check_driver_change_completed"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF NEW.status <> 'completed' OR OLD.status <> 'in_progress' THEN
      RETURN NEW;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "rentals" "r"
      WHERE "r"."id" = NEW.rental_id AND "r"."operator_id" = NEW.operator_id
        AND "r"."driver_id" = NEW.to_driver_id
    ) OR NOT EXISTS (
      SELECT 1 FROM "possessions" "p"
      WHERE "p"."rental_id" = NEW.rental_id AND "p"."operator_id" = NEW.operator_id
        AND "p"."driver_id" = NEW.from_driver_id AND "p"."ended_at" = NEW.changed_at
        AND "p"."return_inspection_id" = NEW.return_inspection_id
    ) OR NOT EXISTS (
      SELECT 1 FROM "possessions" "p"
      WHERE "p"."rental_id" = NEW.rental_id AND "p"."operator_id" = NEW.operator_id
        AND "p"."driver_id" = NEW.to_driver_id AND "p"."started_at" = NEW.changed_at
        AND "p"."handover_inspection_id" = NEW.handover_inspection_id
    ) OR (
      SELECT count(*) FROM "inspections" "i"
      WHERE "i"."operator_id" = NEW.operator_id AND "i"."status" = 'completed'
        AND "i"."id" IN (NEW.return_inspection_id, NEW.handover_inspection_id)
    ) <> 2 THEN
      RAISE EXCEPTION 'A driver change is completed only with the car signed for by the new driver as the last one hands it back.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint
CREATE TRIGGER "rental_driver_changes_completed"
  BEFORE UPDATE OF "status" ON "rental_driver_changes"
  FOR EACH ROW EXECUTE FUNCTION "app"."check_driver_change_completed"();--> statement-breakpoint

-- A car that is out changes driver only through a driver change under way
-- (0057); here, at the end of that transaction, the change must have been
-- completed with it: the new driver's time with the car is the one this
-- change's handover started, and it is still open.
CREATE FUNCTION "app"."check_rental_driver_changed"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM "rental_driver_changes" "change"
      INNER JOIN "possessions" "p" ON "p"."operator_id" = "change"."operator_id"
        AND "p"."rental_id" = "change"."rental_id"
        AND "p"."handover_inspection_id" = "change"."handover_inspection_id"
        AND "p"."ended_at" IS NULL
      WHERE "change"."rental_id" = NEW.id AND "change"."operator_id" = NEW.operator_id
        AND "change"."status" = 'completed'
        AND "change"."from_driver_id" = OLD.driver_id AND "change"."to_driver_id" = NEW.driver_id
    ) THEN
      RAISE EXCEPTION 'Once the car is out, the driver changes only with its driver change completed.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
  END;
  $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "rentals_driver_change_completed"
  AFTER UPDATE OF "driver_id" ON "rentals"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.status = 'active' AND NEW.driver_id IS DISTINCT FROM OLD.driver_id)
  EXECUTE FUNCTION "app"."check_rental_driver_changed"();--> statement-breakpoint

-- The car isn't brought back (the rental leaving 'active') while a driver
-- change is under way: its check-in is the change's, not the return's.
CREATE FUNCTION "app"."check_rental_leaves_active"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM "rental_driver_changes" "change"
      WHERE "change"."rental_id" = NEW.id AND "change"."operator_id" = NEW.operator_id
        AND "change"."status" = 'in_progress'
    ) THEN
      RAISE EXCEPTION 'The car can''t come back while a driver change is under way.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint
CREATE TRIGGER "rentals_leave_active"
  BEFORE UPDATE OF "status" ON "rentals"
  FOR EACH ROW
  WHEN (OLD.status = 'active' AND NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION "app"."check_rental_leaves_active"();
