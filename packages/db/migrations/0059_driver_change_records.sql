-- Business Renters, slice 4 second review (9 Nov 2026, Abhi's standing go
-- for the obvious recommendation). Safe with the code deployed before it
-- running for a short while: see each part.

-- 1. A damage mark a driver change copies onto the new driver's checklist
-- says which mark it shows (and so whose photo) in a column of its own,
-- rather than in the phone's key. Nullable: marks made on a checklist have
-- none.
ALTER TABLE "inspection_damage_marks" ADD COLUMN "copied_from_mark_id" uuid;--> statement-breakpoint
ALTER TABLE "inspection_damage_marks" ADD CONSTRAINT "inspection_damage_marks_copied_from_fk" FOREIGN KEY ("copied_from_mark_id","operator_id") REFERENCES "public"."inspection_damage_marks"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- The copies made so far (by the code deployed with 0058) kept it in the
-- phone's key, which a driver change's handover never otherwise has: moved
-- across, only where the key is the id of a mark of the same business. A
-- finished checklist's marks never change, so that rule (and row security,
-- as the owner runs this for every business) is lifted for the move only,
-- within this migration's transaction, as in 0052.
ALTER TABLE "inspection_damage_marks" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rental_driver_changes" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_damage_marks" DISABLE TRIGGER "inspection_damage_marks_kept";--> statement-breakpoint
UPDATE "inspection_damage_marks" "copy" SET "copied_from_mark_id" = "copy"."client_key", "client_key" = NULL
WHERE "copy"."client_key" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "rental_driver_changes" "change"
    WHERE "change"."operator_id" = "copy"."operator_id"
      AND "change"."handover_inspection_id" = "copy"."inspection_id"
  )
  AND EXISTS (
    SELECT 1 FROM "inspection_damage_marks" "shown"
    WHERE "shown"."id" = "copy"."client_key" AND "shown"."operator_id" = "copy"."operator_id"
  );--> statement-breakpoint
ALTER TABLE "inspection_damage_marks" ENABLE TRIGGER "inspection_damage_marks_kept";--> statement-breakpoint
ALTER TABLE "rental_driver_changes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_damage_marks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- While the code deployed before this still runs (minutes, during the
-- deploy), it copies marks with the mark they show in the phone's key: such
-- a copy is moved across as it is added, so the new code finds its photo,
-- and every copy points at the first mark, never another copy (the old code
-- reads a new copy's key as empty and would name the copy itself). The
-- phone's own key on any other checklist is left alone.
CREATE FUNCTION "app"."link_copied_damage_mark"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  DECLARE
    "first_mark" uuid;
  BEGIN
    IF NEW.client_key IS NOT NULL AND NEW.copied_from_mark_id IS NULL
      AND EXISTS (
        SELECT 1 FROM "rental_driver_changes" "change"
        WHERE "change"."operator_id" = NEW.operator_id
          AND "change"."handover_inspection_id" = NEW.inspection_id
      )
      AND EXISTS (
        SELECT 1 FROM "inspection_damage_marks" "shown"
        WHERE "shown"."id" = NEW.client_key AND "shown"."operator_id" = NEW.operator_id
      )
    THEN
      NEW.copied_from_mark_id := NEW.client_key;
      NEW.client_key := NULL;
    END IF;
    IF NEW.copied_from_mark_id IS NOT NULL THEN
      SELECT "shown"."copied_from_mark_id" INTO "first_mark" FROM "inspection_damage_marks" "shown"
        WHERE "shown"."id" = NEW.copied_from_mark_id AND "shown"."operator_id" = NEW.operator_id;
      NEW.copied_from_mark_id := coalesce("first_mark", NEW.copied_from_mark_id);
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint
CREATE TRIGGER "inspection_damage_marks_copied_from"
  BEFORE INSERT ON "inspection_damage_marks"
  FOR EACH ROW EXECUTE FUNCTION "app"."link_copied_damage_mark"();--> statement-breakpoint

-- 2. Retention: as in 0058, also clearing the reason of a cancelled driver
-- change once the driver it would have handed the car to is retired. The
-- deployed code never clears a reason.
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
$$;--> statement-breakpoint--> statement-breakpoint

-- 3. A driver change is completed as in 0058, and only at the moment it is
-- signed: its hand-over moment within ten minutes of the transaction's (the
-- app signs with the server's clock, never a time queued on a phone, so the
-- deployed code passes).
CREATE OR REPLACE FUNCTION "app"."check_driver_change_completed"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF NEW.status <> 'completed' OR OLD.status <> 'in_progress' THEN
      RETURN NEW;
    END IF;
    -- Signed now, on the Operator's phone: never backdated (or dated ahead)
    -- by a direct write. The app takes the moment as the signing is sent and
    -- makes both reports before this transaction, which the margin allows.
    IF abs(extract(epoch FROM NEW.changed_at - now())) > 600 THEN
      RAISE EXCEPTION 'A driver change is completed at the moment it is signed.'
        USING ERRCODE = 'check_violation';
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
  $$;
