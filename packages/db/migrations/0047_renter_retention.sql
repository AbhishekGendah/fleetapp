ALTER TABLE "renters" DROP CONSTRAINT "renters_has_contact";--> statement-breakpoint
ALTER TABLE "renters" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "renters" ADD CONSTRAINT "renters_has_contact" CHECK ("renters"."retired_at" is not null or num_nonnulls("renters"."phone", "renters"."email") > 0);--> statement-breakpoint

-- Review G8-4 (approved 5 Nov 2026): seven years after a Renter's last
-- rental ended, with nothing still open, the nightly job removes their
-- personal details and their signed PDFs and photos. Money lines, invoice
-- numbers and the history stay as they are (rules 11, 17, 19). Only the
-- narrow function below sets retired_at: the app's role has no grant on it,
-- so the exceptions it opens can't be reached any other way.

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
    'files', 'damage_records', 'issued_documents'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO %I USING ("operator_id" = "app"."current_operator_id"()) WITH CHECK ("operator_id" = "app"."current_operator_id"())',
      "table_name" || '_owner_retention', "table_name", current_user
    );
  END LOOP;
END
$$;--> statement-breakpoint

-- Whether a file belongs to a retired Renter: theirs, sent through their link,
-- from a checklist or damage record of their rental, or one of their rental's
-- issued documents.
CREATE FUNCTION "app"."is_retired_renter_file"(
  "file_id" uuid, "file_renter_id" uuid, "file_link_id" uuid,
  "file_inspection_id" uuid, "file_damage_record_id" uuid
) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "public"."renters" "r"
    WHERE "r"."retired_at" IS NOT NULL AND "r"."id" IN (
      "file_renter_id",
      (SELECT "l"."renter_id" FROM "public"."renter_links" "l" WHERE "l"."id" = "file_link_id"),
      (SELECT "ra"."renter_id" FROM "public"."inspections" "i"
        JOIN "public"."rentals" "ra" ON "ra"."id" = "i"."rental_id"
        WHERE "i"."id" = "file_inspection_id"),
      (SELECT "d"."renter_id" FROM "public"."damage_records" "d" WHERE "d"."id" = "file_damage_record_id"),
      (SELECT "ra"."renter_id" FROM "public"."issued_documents" "doc"
        JOIN "public"."rentals" "ra" ON "ra"."id" = "doc"."rental_id"
        WHERE "doc"."file_id" = "is_retired_renter_file"."file_id")
    )
  )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."is_retired_renter_file"(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;--> statement-breakpoint
-- Called by the files triggers, which run as the app; it answers yes or no and nothing else.
GRANT EXECUTE ON FUNCTION "app"."is_retired_renter_file"(uuid, uuid, uuid, uuid, uuid) TO "web_app_role", "admin_app_role";--> statement-breakpoint

-- A retired Renter's file may be binned and then removed for good; nothing
-- else about it changes. Otherwise as in 0030.
CREATE OR REPLACE FUNCTION "app"."keep_issued_document_files"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF TG_OP = 'UPDATE'
      AND NEW.object_key IS NOT DISTINCT FROM OLD.object_key
      AND NEW.purpose IS NOT DISTINCT FROM OLD.purpose
      AND NEW.confirmed_at IS NOT DISTINCT FROM OLD.confirmed_at
      AND "app"."is_retired_renter_file"(OLD.id, OLD.renter_id, OLD.renter_link_id, OLD.inspection_id, OLD.damage_record_id)
    THEN
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

-- As in 0046, plus: a retired Renter's checklist photos may be binned and removed.
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
    IF TG_OP = 'UPDATE'
      AND NEW.object_key IS NOT DISTINCT FROM OLD.object_key
      AND NEW.confirmed_at IS NOT DISTINCT FROM OLD.confirmed_at
      AND "app"."is_retired_renter_file"(OLD.id, OLD.renter_id, OLD.renter_link_id, OLD.inspection_id, OLD.damage_record_id)
    THEN
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

-- A finished checklist is kept as it is, except that a retired Renter's
-- typed name is removed from it. Otherwise as in 0033.
CREATE OR REPLACE FUNCTION "app"."keep_finished_inspection"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF TG_OP = 'UPDATE'
      AND (to_jsonb(NEW) - 'typed_name') = (to_jsonb(OLD) - 'typed_name')
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

-- Signing evidence is append-only, except that a retired Renter's (their
-- internet address and phone) is removed with the documents it proved.
CREATE FUNCTION "app"."keep_signing_evidence"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' AND EXISTS (
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

-- When a Renter's records' time is up: seven years after the later of being
-- added and their last rental ending. Never earlier than seven years ago,
-- whatever is asked, so a mistaken call can't remove anyone sooner.
CREATE FUNCTION "app"."renter_records_kept_until"("renter_id" uuid) RETURNS timestamp with time zone
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT greatest("r"."created_at", max(coalesce("ra"."returned_at", "ra"."cancelled_at")))
    + interval '7 years'
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
      WHERE "ra"."renter_id" = "r"."id" AND "ra"."status" IN ('booked', 'active')
    )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."operators_with_renters_to_retire"(timestamp with time zone) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."operators_with_renters_to_retire"(timestamp with time zone) TO "web_app_role";--> statement-breakpoint

-- Removes one Renter's personal details, of the business the job is working
-- for (rule 3), once their time is up and nothing is open. Checked again
-- here, under a lock, so a booking made meanwhile stops it. True if done.
-- Money lines, bond, invoices, payments and the history are left alone.
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
    PERFORM 1 FROM "public"."renters"
      WHERE "id" = "target" AND "operator_id" = "operator" AND "retired_at" IS NULL
      FOR UPDATE;
    IF NOT FOUND THEN
      RETURN false;
    END IF;
    PERFORM 1 FROM "public"."rentals"
      WHERE "renter_id" = "target" AND "operator_id" = "operator"
      FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM "public"."rentals"
      WHERE "renter_id" = "target" AND "operator_id" = "operator" AND "status" IN ('booked', 'active')
    ) OR "app"."renter_records_kept_until"("target") > now() THEN
      RETURN false;
    END IF;

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

    DELETE FROM "public"."renter_notes" WHERE "renter_id" = "target" AND "operator_id" = "operator";
    UPDATE "public"."files" SET "submission_id" = NULL, "updated_at" = now()
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
    UPDATE "public"."renter_links" SET "sent_to_email" = 'removed', "code_hash" = NULL, "code_expires_at" = NULL, "updated_at" = now()
    WHERE "renter_id" = "target" AND "operator_id" = "operator";
    UPDATE "public"."inspections" SET "typed_name" = 'Removed'
    WHERE "operator_id" = "operator" AND "typed_name" IS NOT NULL AND "rental_id" IN (
      SELECT "id" FROM "public"."rentals" WHERE "renter_id" = "target" AND "operator_id" = "operator"
    );
    UPDATE "public"."rentals" SET "notes" = NULL, "updated_at" = now()
    WHERE "renter_id" = "target" AND "operator_id" = "operator" AND "notes" IS NOT NULL;

    -- Binned now, removed for good by the usual clean-up 30 days later.
    UPDATE "public"."files" SET "deleted_at" = now(), "updated_at" = now()
    WHERE "operator_id" = "operator" AND "deleted_at" IS NULL AND (
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
    );
    RETURN true;
  END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."retire_renter"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."retire_renter"(uuid) TO "web_app_role";
