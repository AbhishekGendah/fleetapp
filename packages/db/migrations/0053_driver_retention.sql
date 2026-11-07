-- Business Renters, slice 1 (docs/plans/business-renters.md, Migration A
-- step 8): the seven-year retention (0047, 0048) now counts driving. Until
-- now it looked only at a Renter's own rentals, so a driver of a business's
-- cars with no rental of their own would have been retired seven years after
-- being added, mid-rental. A person's own rentals are driven by them, so for
-- every Renter today the answers are unchanged.

-- The job's owner reads who had which car, and who drives for whom, across
-- businesses for the Operator IDs only, as in 0047.
DO $$
DECLARE
  "table_name" text;
BEGIN
  FOREACH "table_name" IN ARRAY ARRAY['possessions', 'organisation_drivers'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO %I USING (true)',
      "table_name" || '_owner_retention_read', "table_name", current_user
    );
  END LOOP;
END
$$;--> statement-breakpoint

-- Whether anything still ties a Renter to a car or a business: a draft,
-- booking or car out naming them as Renter or driver, a car they still have,
-- or a current link between a driver and a business (either side).
CREATE FUNCTION "app"."is_renter_in_use"("target" uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "public"."renters" "r"
    WHERE "r"."id" = "target" AND (
      EXISTS (
        SELECT 1 FROM "public"."rentals" "ra"
        WHERE "ra"."operator_id" = "r"."operator_id"
          AND ("ra"."renter_id" = "r"."id" OR "ra"."driver_id" = "r"."id")
          AND "ra"."status" IN ('draft', 'booked', 'active'))
      OR EXISTS (
        SELECT 1 FROM "public"."possessions" "p"
        WHERE "p"."operator_id" = "r"."operator_id" AND "p"."driver_id" = "r"."id"
          AND "p"."ended_at" IS NULL)
      OR EXISTS (
        SELECT 1 FROM "public"."organisation_drivers" "od"
        WHERE "od"."operator_id" = "r"."operator_id"
          AND ("od"."driver_id" = "r"."id" OR "od"."organisation_id" = "r"."id")
          AND "od"."removed_at" IS NULL)
    )
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."is_renter_in_use"(uuid) FROM PUBLIC;--> statement-breakpoint
-- Runs with the caller's own rights, so row-level security still keeps each business to its own.
GRANT EXECUTE ON FUNCTION "app"."is_renter_in_use"(uuid) TO "web_app_role";--> statement-breakpoint

-- When a Renter's records' time is up: seven years after the latest of being
-- recorded, a rental naming them (as Renter or driver) being recorded or
-- ending, their time with a car ending, and their link to a business ending.
CREATE OR REPLACE FUNCTION "app"."renter_records_kept_until"("renter_id" uuid) RETURNS timestamp with time zone
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT greatest(
      "r"."created_at",
      (SELECT max(greatest("ra"."created_at", coalesce("ra"."returned_at", "ra"."cancelled_at")))
        FROM "public"."rentals" "ra"
        WHERE "ra"."operator_id" = "r"."operator_id"
          AND ("ra"."renter_id" = "r"."id" OR "ra"."driver_id" = "r"."id")),
      (SELECT max(coalesce("p"."ended_at", "p"."started_at"))
        FROM "public"."possessions" "p"
        WHERE "p"."operator_id" = "r"."operator_id" AND "p"."driver_id" = "r"."id"),
      (SELECT max("od"."removed_at")
        FROM "public"."organisation_drivers" "od"
        WHERE "od"."operator_id" = "r"."operator_id"
          AND ("od"."driver_id" = "r"."id" OR "od"."organisation_id" = "r"."id"))
    ) + interval '7 years'
  FROM "public"."renters" "r"
  WHERE "r"."id" = "renter_records_kept_until"."renter_id"
$$;--> statement-breakpoint

-- As in 0047, with "nothing open" now counting driving and links.
CREATE OR REPLACE FUNCTION "app"."operators_with_renters_to_retire"("due_by" timestamp with time zone)
  RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT DISTINCT "r"."operator_id" FROM "public"."renters" "r"
  WHERE "r"."retired_at" IS NULL
    AND "app"."renter_records_kept_until"("r"."id") <= least("due_by", now())
    AND NOT "app"."is_renter_in_use"("r"."id")
$$;--> statement-breakpoint

-- As in 0047, also locking the rentals they drive: the retirement waits for
-- anything changing those, and anything starting one waits for it.
CREATE OR REPLACE FUNCTION "app"."lock_renter_for_retirement"("target" uuid) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  BEGIN
    PERFORM 1 FROM "public"."renters"
      WHERE "id" = "target" AND "operator_id" = "app"."current_operator_id"() AND "retired_at" IS NULL
      FOR UPDATE;
    IF NOT FOUND THEN
      RETURN false;
    END IF;
    PERFORM 1 FROM "public"."rentals"
      WHERE ("renter_id" = "target" OR "driver_id" = "target")
        AND "operator_id" = "app"."current_operator_id"()
      FOR UPDATE;
    RETURN true;
  END;
$$;--> statement-breakpoint

-- The rentals whose personal records go once this Renter is retired: those
-- they were party to (the Renter, the driver named, or a driver who had the
-- car), once every party is retired. A business's rental holds both its
-- contact's and its drivers' details (typed names, signed reports, photos),
-- so it waits for the last of them (approved plan, Migration A step 8). For
-- a person's own rental the Renter is the only party, as before. Run as the
-- owner, inside "app"."retire_renter" only.
CREATE FUNCTION "app"."rentals_cleared_with"("target" uuid) RETURNS SETOF uuid
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT "ra"."id" FROM "public"."rentals" "ra"
  WHERE "ra"."operator_id" = "app"."current_operator_id"()
    AND ("ra"."renter_id" = "target" OR "ra"."driver_id" = "target" OR EXISTS (
      SELECT 1 FROM "public"."possessions" "p"
      WHERE "p"."rental_id" = "ra"."id" AND "p"."operator_id" = "ra"."operator_id"
        AND "p"."driver_id" = "target"))
    AND NOT EXISTS (
      SELECT 1 FROM "public"."renters" "party"
      WHERE "party"."operator_id" = "ra"."operator_id" AND "party"."retired_at" IS NULL
        AND ("party"."id" = "ra"."renter_id" OR "party"."id" = "ra"."driver_id" OR "party"."id" IN (
          SELECT "p"."driver_id" FROM "public"."possessions" "p"
          WHERE "p"."rental_id" = "ra"."id" AND "p"."operator_id" = "ra"."operator_id")))
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."rentals_cleared_with"(uuid) FROM PUBLIC;--> statement-breakpoint

-- As in 0048, except: nothing open now counts driving and links; a business's
-- own details are removed too; and a rental's records go only with the last
-- of its parties ("app"."rentals_cleared_with"). Their own files, links,
-- notes and damage records go with them, as before.
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
$$;
