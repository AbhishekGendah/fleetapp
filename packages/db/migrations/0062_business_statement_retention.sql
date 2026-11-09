-- Business Renters slice 5 review (approved by Abhi, 9 Nov 2026): when a
-- business Renter is retired, the retention job also bins its own
-- statements across its cars (issued_documents.renter_id, 0061), which name
-- its drivers, as it bins a rental's papers once all its parties are retired.
-- The documents' rows stay (rule 12, the tax record of what was issued); their
-- PDFs are binned now and removed for good by the usual clean-up 30 days on.
--
-- Two functions are replaced, nothing else changes. Safe with the code of
-- 0061 still running: that code never calls either differently, and only
-- the retention job (as the owner) bins a file. No backfill: a statement can
-- only have been made since 0061, and no business retired since then has
-- one (a retired business is archived, and the new code refuses it one).

-- 1. A retired Renter's file now also covers their own statements, so the
-- files rules let the retention job bin and then remove those PDFs. As in
-- 0047, with the one line added.
CREATE OR REPLACE FUNCTION "app"."is_retired_renter_file"(
  "file_id" uuid, "file_renter_id" uuid, "file_link_id" uuid,
  "file_inspection_id" uuid, "file_damage_record_id" uuid, "file_thumbnail_of" uuid
) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "public"."renters" "r"
    WHERE "r"."retired_at" IS NOT NULL
      AND "r"."operator_id" = "app"."current_operator_id"()
      AND "r"."id" IN (
        "file_renter_id",
        (SELECT "l"."renter_id" FROM "public"."renter_links" "l" WHERE "l"."id" = "file_link_id"),
        (SELECT "ra"."renter_id" FROM "public"."inspections" "i"
          JOIN "public"."rentals" "ra" ON "ra"."id" = "i"."rental_id"
          WHERE "i"."id" = "file_inspection_id"),
        (SELECT "d"."renter_id" FROM "public"."damage_records" "d" WHERE "d"."id" = "file_damage_record_id"),
        (SELECT "ra"."renter_id" FROM "public"."issued_documents" "doc"
          JOIN "public"."rentals" "ra" ON "ra"."id" = "doc"."rental_id"
          WHERE "doc"."file_id" = "is_retired_renter_file"."file_id"),
        (SELECT "doc"."renter_id" FROM "public"."issued_documents" "doc"
          WHERE "doc"."file_id" = "is_retired_renter_file"."file_id"),
        (SELECT "ra"."renter_id" FROM "public"."files" "p"
          JOIN "public"."inspections" "i" ON "i"."id" = "p"."inspection_id"
          JOIN "public"."rentals" "ra" ON "ra"."id" = "i"."rental_id"
          WHERE "p"."id" = "file_thumbnail_of"),
        (SELECT "d"."renter_id" FROM "public"."files" "p"
          JOIN "public"."damage_records" "d" ON "d"."id" = "p"."damage_record_id"
          WHERE "p"."id" = "file_thumbnail_of")
      )
  )
$$;--> statement-breakpoint
-- 2. Retirement: as in 0059, also binning the Renter's own statements.
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
        -- A business's own statements across its cars (0061), which name its drivers.
        OR "id" IN (
          SELECT "doc"."file_id" FROM "public"."issued_documents" "doc"
          WHERE "doc"."operator_id" = "operator" AND "doc"."renter_id" = "target")
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
    -- A cancelled driver change's reason may name the driver it would have
    -- handed the car to, who never had it, so isn't one of the rental's
    -- parties: it goes with them too, whoever else is kept.
    UPDATE "public"."rental_driver_changes" SET "reason" = 'Removed', "updated_at" = now()
    WHERE "operator_id" = "operator" AND "reason" <> 'Removed'
      AND "status" = 'cancelled' AND "to_driver_id" = "target";
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
