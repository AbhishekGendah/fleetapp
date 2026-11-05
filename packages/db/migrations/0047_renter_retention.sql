ALTER TABLE "renters" DROP CONSTRAINT "renters_has_contact";--> statement-breakpoint
ALTER TABLE "renters" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "renters" ADD CONSTRAINT "renters_has_contact" CHECK ("renters"."retired_at" is not null or num_nonnulls("renters"."phone", "renters"."email") > 0);--> statement-breakpoint

-- Review G8-4 (approved 5 Nov 2026): seven years after a Renter's last
-- rental ended, with nothing still open, the nightly job removes their
-- personal details and bins their signed PDFs and photos. Money lines,
-- invoice numbers and the history stay as they are (rules 11, 17, 19).
--
-- Only "app"."retire_renter" (run as the owner) sets retired_at, and every
-- exception below for a retired Renter's records also requires the owner,
-- except removing an already-binned file for good, which the app's usual
-- clean-up does. So the app's own role can't use a retirement to bin,
-- un-bin or change records that are otherwise kept (review of batch 5).

-- Whether the current statement runs as the tables' owner: inside one of the
-- SECURITY DEFINER functions below, never as an app role.
CREATE FUNCTION "app"."runs_as_owner"("rel" oid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT pg_get_userbyid("c"."relowner") = current_user FROM pg_class "c" WHERE "c"."oid" = "rel"
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."runs_as_owner"(oid) TO "web_app_role", "admin_app_role";--> statement-breakpoint

-- A retired Renter is kept as the job left them: nothing changes their row
-- and nothing new is added for them, except by the owner.
CREATE FUNCTION "app"."keep_retired_renter"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF OLD.retired_at IS NOT NULL AND NOT "app"."runs_as_owner"(TG_RELID) THEN
      RAISE EXCEPTION 'A Renter whose details were removed is kept as they are.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.retired_at IS DISTINCT FROM OLD.retired_at AND NOT "app"."runs_as_owner"(TG_RELID) THEN
      RAISE EXCEPTION 'Only the retention job marks a Renter retired.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint
CREATE TRIGGER "renters_retired_kept"
  BEFORE UPDATE ON "renters"
  FOR EACH ROW EXECUTE FUNCTION "app"."keep_retired_renter"();--> statement-breakpoint
CREATE FUNCTION "app"."refuse_retired_renter_records"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF NEW.renter_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM "renters" WHERE "id" = NEW.renter_id AND "retired_at" IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'A Renter whose details were removed can''t be given new records.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint
CREATE TRIGGER "rentals_not_for_retired_renters"
  BEFORE INSERT ON "rentals"
  FOR EACH ROW EXECUTE FUNCTION "app"."refuse_retired_renter_records"();--> statement-breakpoint
CREATE TRIGGER "renter_links_not_for_retired_renters"
  BEFORE INSERT ON "renter_links"
  FOR EACH ROW EXECUTE FUNCTION "app"."refuse_retired_renter_records"();--> statement-breakpoint
CREATE TRIGGER "renter_notes_not_for_retired_renters"
  BEFORE INSERT ON "renter_notes"
  FOR EACH ROW EXECUTE FUNCTION "app"."refuse_retired_renter_records"();--> statement-breakpoint
CREATE TRIGGER "files_not_for_retired_renters"
  BEFORE INSERT ON "files"
  FOR EACH ROW EXECUTE FUNCTION "app"."refuse_retired_renter_records"();--> statement-breakpoint

-- The seven-year clock starts no later than when a Renter or rental was
-- recorded, so those times are the database's, never the app's.
CREATE FUNCTION "app"."stamp_created_at"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF NOT "app"."runs_as_owner"(TG_RELID) THEN
      NEW.created_at := now();
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint
CREATE TRIGGER "renters_created_now"
  BEFORE INSERT ON "renters"
  FOR EACH ROW EXECUTE FUNCTION "app"."stamp_created_at"();--> statement-breakpoint
CREATE TRIGGER "rentals_created_now"
  BEFORE INSERT ON "rentals"
  FOR EACH ROW EXECUTE FUNCTION "app"."stamp_created_at"();--> statement-breakpoint

-- The functions below run as the database owner, which forced row-level
-- security also binds. As in 0007, the owner gets its own policies: a read
-- of every business's Renters and rentals, so the job can find which
-- businesses have work (Operator IDs only), and changes only within the
-- business the job has set for its transaction (rule 3). The owner could
-- turn row-level security off anyway, so this opens nothing new; the app's
-- roles still only call the functions.
DO $$
DECLARE
  "table_name" text;
BEGIN
  FOREACH "table_name" IN ARRAY ARRAY['renters', 'rentals'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO %I USING (true)',
      "table_name" || '_owner_retention_read', "table_name", current_user
    );
  END LOOP;
  FOREACH "table_name" IN ARRAY ARRAY[
    'renters', 'rentals', 'renter_notes', 'renter_submissions', 'renter_links',
    'renter_link_devices', 'renter_link_attempts', 'signing_evidence', 'inspections',
    'inspection_damage_marks', 'files', 'damage_records', 'insurance_claims', 'issued_documents'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO %I USING ("operator_id" = "app"."current_operator_id"()) WITH CHECK ("operator_id" = "app"."current_operator_id"())',
      "table_name" || '_owner_retention', "table_name", current_user
    );
  END LOOP;
END
$$;--> statement-breakpoint

-- Whether a file belongs to a retired Renter of the business set for this
-- transaction: theirs, sent through their link, from a checklist or damage
-- record of their rental, one of their rental's issued documents, or the
-- small copy of any of those.
CREATE FUNCTION "app"."is_retired_renter_file"(
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
REVOKE ALL ON FUNCTION "app"."is_retired_renter_file"(uuid, uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
-- Called by the files triggers, which run as the app; it answers yes or no
-- about the app's own business only.
GRANT EXECUTE ON FUNCTION "app"."is_retired_renter_file"(uuid, uuid, uuid, uuid, uuid, uuid) TO "web_app_role";--> statement-breakpoint

-- What a retired Renter's file may go through, and nothing else: binned by
-- the retention job (owner only), then removed for good by the usual
-- clean-up. Never un-binned, never re-pointed, never otherwise changed.
CREATE FUNCTION "app"."is_retired_file_step"("old_file" "public"."files", "new_file" "public"."files", "rel" oid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT
    (to_jsonb("new_file") - 'deleted_at' - 'purged_at' - 'updated_at')
      = (to_jsonb("old_file") - 'deleted_at' - 'purged_at' - 'updated_at')
    AND (
      ("old_file"."deleted_at" IS NULL AND "new_file"."deleted_at" IS NOT NULL
        AND "new_file"."purged_at" IS NOT DISTINCT FROM "old_file"."purged_at"
        AND "app"."runs_as_owner"("rel"))
      OR ("old_file"."deleted_at" IS NOT NULL
        AND "new_file"."deleted_at" IS NOT DISTINCT FROM "old_file"."deleted_at"
        AND "old_file"."purged_at" IS NULL AND "new_file"."purged_at" IS NOT NULL)
    )
    AND "app"."is_retired_renter_file"("old_file"."id", "old_file"."renter_id", "old_file"."renter_link_id",
      "old_file"."inspection_id", "old_file"."damage_record_id", "old_file"."thumbnail_of_file_id")
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."is_retired_file_step"("public"."files", "public"."files", oid) TO "web_app_role";--> statement-breakpoint

-- As in 0030, plus a retired Renter's issued PDFs may be binned and removed.
CREATE OR REPLACE FUNCTION "app"."keep_issued_document_files"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF TG_OP = 'UPDATE' AND "app"."is_retired_file_step"(OLD, NEW, TG_RELID) THEN
      RETURN NEW;
    END IF;
    IF OLD.purpose::text = 'issued_document' AND OLD.confirmed_at IS NOT NULL AND (
      TG_OP = 'DELETE'
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
      OR NEW.purged_at IS DISTINCT FROM OLD.purged_at
      OR NEW.object_key IS DISTINCT FROM OLD.object_key
      OR NEW.purpose IS DISTINCT FROM OLD.purpose
      OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
    ) THEN
      RAISE EXCEPTION 'An issued document''s file is kept for good.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END;
  $$;--> statement-breakpoint

-- As in 0046, plus a retired Renter's checklist photos may be binned and removed.
CREATE OR REPLACE FUNCTION "app"."keep_finished_inspection_photos"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.inspection_id IS NOT NULL AND NOT "app"."is_inspection_in_progress"(NEW.inspection_id) THEN
        RAISE EXCEPTION 'Photos are added only while the checklist is in progress.'
          USING ERRCODE = 'restrict_violation';
      END IF;
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.inspection_id IS NOT NULL AND OLD.confirmed_at IS NULL
      AND NEW.confirmed_at IS NOT NULL
      AND NOT "app"."is_inspection_in_progress"(OLD.inspection_id)
    THEN
      RAISE EXCEPTION 'Photos are added only while the checklist is in progress.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.deleted_at IS NOT NULL
      AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at
      AND NEW.object_key IS NOT DISTINCT FROM OLD.object_key
    THEN
      -- Binned while the checklist was open: it was never one the finished checklist kept.
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND "app"."is_retired_file_step"(OLD, NEW, TG_RELID) THEN
      RETURN NEW;
    END IF;
    IF OLD.inspection_id IS NOT NULL AND OLD.confirmed_at IS NOT NULL
      AND NOT "app"."is_inspection_in_progress"(OLD.inspection_id)
      AND EXISTS (SELECT 1 FROM "inspections" WHERE id = OLD.inspection_id AND status = 'completed')
      AND (TG_OP = 'DELETE'
        OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
        OR NEW.purged_at IS DISTINCT FROM OLD.purged_at
        OR NEW.object_key IS DISTINCT FROM OLD.object_key)
    THEN
      RAISE EXCEPTION 'A finished checklist''s photos are kept with it.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END;
  $$;--> statement-breakpoint

-- A finished checklist is kept as it is, except that the retention job (as
-- the owner) removes a retired Renter's typed name and the free text that
-- may name them. Otherwise as in 0033.
CREATE OR REPLACE FUNCTION "app"."keep_finished_inspection"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF TG_OP = 'UPDATE' AND "app"."runs_as_owner"(TG_RELID)
      AND (to_jsonb(NEW) - 'typed_name' - 'notes' - 'accessories' - 'bond_override_reason'
            - 'direct_debit_override_reason' - 'updated_at')
        = (to_jsonb(OLD) - 'typed_name' - 'notes' - 'accessories' - 'bond_override_reason'
            - 'direct_debit_override_reason' - 'updated_at')
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

-- Damage marks on a finished checklist are kept, except that the retention
-- job (as the owner) removes a retired Renter's descriptions. Otherwise as in 0033.
CREATE OR REPLACE FUNCTION "app"."keep_finished_damage_marks"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF TG_OP = 'UPDATE' AND "app"."runs_as_owner"(TG_RELID)
      AND (to_jsonb(NEW) - 'description' - 'updated_at') = (to_jsonb(OLD) - 'description' - 'updated_at')
      AND EXISTS (
        SELECT 1 FROM "inspections" "i"
        JOIN "rentals" "ra" ON "ra"."id" = "i"."rental_id"
        JOIN "renters" "r" ON "r"."id" = "ra"."renter_id"
        WHERE "i"."id" = OLD.inspection_id AND "r"."retired_at" IS NOT NULL
      )
    THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE'
      OR NOT "app"."is_inspection_in_progress"(CASE WHEN TG_OP = 'INSERT' THEN NEW.inspection_id ELSE OLD.inspection_id END)
    THEN
      RAISE EXCEPTION 'Damage marks change only while the checklist is in progress.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint

-- Signing evidence is append-only, except that the retention job (as the
-- owner) removes a retired Renter's (their internet address and phone)
-- along with the documents it proved.
CREATE FUNCTION "app"."keep_signing_evidence"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' AND "app"."runs_as_owner"(TG_RELID) AND EXISTS (
      SELECT 1 FROM "renter_links" "l" JOIN "renters" "r" ON "r"."id" = "l"."renter_id"
      WHERE "l"."id" = OLD.link_id AND "r"."retired_at" IS NOT NULL
    ) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Table % is append-only; % is not allowed.', TG_TABLE_NAME, TG_OP
      USING ERRCODE = 'restrict_violation';
  END;
  $$;--> statement-breakpoint
DROP TRIGGER "signing_evidence_append_only" ON "signing_evidence";--> statement-breakpoint
CREATE TRIGGER "signing_evidence_append_only"
  BEFORE UPDATE OR DELETE ON "signing_evidence"
  FOR EACH ROW EXECUTE FUNCTION "app"."keep_signing_evidence"();--> statement-breakpoint

-- When a Renter's records' time is up: seven years after the latest of
-- being recorded, a rental being recorded, and a rental ending. A draft
-- or a new booking therefore restarts the clock. The record times are
-- stamped by the database (above).
CREATE FUNCTION "app"."renter_records_kept_until"("renter_id" uuid) RETURNS timestamp with time zone
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT greatest(
      "r"."created_at",
      max("ra"."created_at"),
      max(coalesce("ra"."returned_at", "ra"."cancelled_at"))
    ) + interval '7 years'
  FROM "public"."renters" "r"
  LEFT JOIN "public"."rentals" "ra"
    ON "ra"."renter_id" = "r"."id" AND "ra"."operator_id" = "r"."operator_id"
  WHERE "r"."id" = "renter_records_kept_until"."renter_id"
  GROUP BY "r"."created_at"
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."renter_records_kept_until"(uuid) FROM PUBLIC;--> statement-breakpoint
-- Runs with the caller's own rights, so row-level security still keeps each business to its own.
GRANT EXECUTE ON FUNCTION "app"."renter_records_kept_until"(uuid) TO "web_app_role";--> statement-breakpoint

-- The Operators with a Renter whose time may be up: IDs only (rule 3). The
-- job then checks each Renter's money and damage within that Operator.
CREATE FUNCTION "app"."operators_with_renters_to_retire"("due_by" timestamp with time zone)
  RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT DISTINCT "r"."operator_id" FROM "public"."renters" "r"
  WHERE "r"."retired_at" IS NULL
    AND "app"."renter_records_kept_until"("r"."id") <= least("due_by", now())
    AND NOT EXISTS (
      SELECT 1 FROM "public"."rentals" "ra"
      WHERE "ra"."renter_id" = "r"."id" AND "ra"."status" IN ('draft', 'booked', 'active')
    )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."operators_with_renters_to_retire"(timestamp with time zone) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."operators_with_renters_to_retire"(timestamp with time zone) TO "web_app_role";--> statement-breakpoint

-- Removes one Renter's personal details, of the business the job is working
-- for (rule 3). True if done. It re-checks, under its lock, that their time
-- is up (by the database's clock, never sooner) and that no draft, booking
-- or car out is open. Money, bond and damage matters are checked by the job
-- (lib/renters/renter-retirement.ts) under the same lock, which it takes
-- first with "app"."lock_renter_for_retirement". Money lines, bond, invoices,
-- payments and the history are left alone.
CREATE FUNCTION "app"."lock_renter_for_retirement"("target" uuid) RETURNS boolean
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
      WHERE "renter_id" = "target" AND "operator_id" = "app"."current_operator_id"()
      FOR UPDATE;
    RETURN true;
  END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."lock_renter_for_retirement"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."lock_renter_for_retirement"(uuid) TO "web_app_role";--> statement-breakpoint

CREATE FUNCTION "app"."retire_renter"("target" uuid) RETURNS boolean
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
      "direct_debit_override_reason" = CASE WHEN "direct_debit_override_reason" IS NULL THEN NULL ELSE 'Removed' END
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
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."retire_renter"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."retire_renter"(uuid) TO "web_app_role";
