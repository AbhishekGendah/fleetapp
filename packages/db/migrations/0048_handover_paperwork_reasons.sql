ALTER TABLE "inspections" ADD COLUMN "insurance_override_reason" text;--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "rego_override_reason" text;--> statement-breakpoint
-- Why a car went with no insurance or rego on file (review A8-2): typed by
-- the business at handover, like the bond and direct debit reasons.
GRANT UPDATE ("insurance_override_reason", "rego_override_reason") ON "inspections" TO "web_app_role";--> statement-breakpoint

-- A finished checklist is kept as it is, except that the retention job (as
-- the owner) removes a retired Renter's typed name and the free text that
-- may name them. Otherwise as in 0033. Now with the paperwork reasons (0048).
CREATE OR REPLACE FUNCTION "app"."keep_finished_inspection"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF TG_OP = 'UPDATE' AND "app"."runs_as_owner"(TG_RELID)
      AND (to_jsonb(NEW) - 'typed_name' - 'notes' - 'accessories' - 'bond_override_reason'
            - 'direct_debit_override_reason' - 'insurance_override_reason' - 'rego_override_reason'
            - 'updated_at')
        = (to_jsonb(OLD) - 'typed_name' - 'notes' - 'accessories' - 'bond_override_reason'
            - 'direct_debit_override_reason' - 'insurance_override_reason' - 'rego_override_reason'
            - 'updated_at')
      AND EXISTS (
        SELECT 1 FROM "rentals" "ra" JOIN "renters" "r" ON "r"."id" = "ra"."renter_id"
        WHERE "ra"."id" = OLD.rental_id AND "r"."retired_at" IS NOT NULL
      )
    THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' OR OLD.status <> 'in_progress' THEN
      RAISE EXCEPTION 'A finished checklist is kept as it is.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint

-- As in 0047, and now also blanking the two new reasons, which may name the Renter.
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
    IF EXISTS (
      SELECT 1 FROM "public"."rentals"
      WHERE "renter_id" = "target" AND "operator_id" = "operator"
        AND "status" IN ('draft', 'booked', 'active')
    ) OR "app"."renter_records_kept_until"("target") > now() THEN
      RETURN false;
    END IF;

    -- Marked retired first: the protections above allow the rest only for a retired Renter.
    UPDATE "public"."renters" SET
      "full_name" = 'Removed Renter', "preferred_name" = NULL, "date_of_birth" = NULL,
      "phone" = NULL, "email" = NULL, "residential_address" = NULL, "postal_address" = NULL,
      "emergency_contact_name" = NULL, "emergency_contact_phone" = NULL,
      "emergency_contact_relationship" = NULL,
      "licence_issued_in" = NULL, "licence_country" = NULL, "licence_number" = NULL,
      "licence_class" = NULL, "licence_type" = NULL, "licence_expires_on" = NULL,
      "status" = 'active', "do_not_rent_reason" = NULL,
      "retired_at" = now(), "archived_at" = coalesce("archived_at", now()), "updated_at" = now()
    WHERE "id" = "target" AND "operator_id" = "operator";

    -- Then their files (and the small copies of them), binned now and
    -- removed for good by the usual clean-up 30 days later. Binned before
    -- anything is unlinked, so no "one live photo per side" rule can clash.
    WITH "theirs" AS (
      SELECT "id" FROM "public"."files"
      WHERE "operator_id" = "operator" AND (
        "renter_id" = "target"
        OR "renter_link_id" IN (
          SELECT "id" FROM "public"."renter_links" WHERE "renter_id" = "target" AND "operator_id" = "operator")
        OR "inspection_id" IN (
          SELECT "i"."id" FROM "public"."inspections" "i"
          JOIN "public"."rentals" "ra" ON "ra"."id" = "i"."rental_id"
          WHERE "ra"."renter_id" = "target" AND "ra"."operator_id" = "operator")
        OR "damage_record_id" IN (
          SELECT "id" FROM "public"."damage_records" WHERE "renter_id" = "target" AND "operator_id" = "operator")
        OR "id" IN (
          SELECT "doc"."file_id" FROM "public"."issued_documents" "doc"
          JOIN "public"."rentals" "ra" ON "ra"."id" = "doc"."rental_id"
          WHERE "ra"."renter_id" = "target" AND "ra"."operator_id" = "operator")
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
    WHERE "renter_id" = "target" AND "operator_id" = "operator";
    UPDATE "public"."inspections" SET
      "typed_name" = CASE WHEN "typed_name" IS NULL THEN NULL ELSE 'Removed' END,
      "notes" = NULL, "accessories" = NULL,
      "bond_override_reason" = CASE WHEN "bond_override_reason" IS NULL THEN NULL ELSE 'Removed' END,
      "direct_debit_override_reason" = CASE WHEN "direct_debit_override_reason" IS NULL THEN NULL ELSE 'Removed' END,
      "insurance_override_reason" = CASE WHEN "insurance_override_reason" IS NULL THEN NULL ELSE 'Removed' END,
      "rego_override_reason" = CASE WHEN "rego_override_reason" IS NULL THEN NULL ELSE 'Removed' END
    WHERE "operator_id" = "operator" AND "rental_id" IN (
      SELECT "id" FROM "public"."rentals" WHERE "renter_id" = "target" AND "operator_id" = "operator"
    );
    UPDATE "public"."inspection_damage_marks" SET "description" = 'Removed'
    WHERE "operator_id" = "operator" AND "inspection_id" IN (
      SELECT "i"."id" FROM "public"."inspections" "i"
      JOIN "public"."rentals" "ra" ON "ra"."id" = "i"."rental_id"
      WHERE "ra"."renter_id" = "target" AND "ra"."operator_id" = "operator"
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
