-- Lock modes (9 Nov 2026, from the slice 4 reviews; docs/plans/
-- business-renters.md, "Lock order"). The app now locks a rental it changes
-- FOR NO KEY UPDATE, which leaves free the "key share" lock a new row
-- linking to the rental takes (a damage record, a ledger line). The start
-- rules for a driver change and a car swap locked the rental again FOR
-- UPDATE: already held by the app, but the stronger lock would then wait
-- for every such link under way, and could deadlock with one waiting for
-- something the start holds. They now take the app's own lock, so nothing
-- else changes. Only the lock mode differs from 0057. Safe with the code
-- deployed before it: that code holds the rental FOR UPDATE first, which
-- already covers this lock.
CREATE OR REPLACE FUNCTION "app"."check_driver_change_start"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  DECLARE
    "rental" record;
  BEGIN
    SELECT "r"."status", "r"."driver_id", "k"."kind" AS "renter_kind" INTO "rental"
      FROM "rentals" "r"
      INNER JOIN "renters" "k" ON "k"."id" = "r"."renter_id" AND "k"."operator_id" = "r"."operator_id"
      WHERE "r"."id" = NEW.rental_id AND "r"."operator_id" = NEW.operator_id
      FOR NO KEY UPDATE OF "r";
    IF NOT FOUND THEN
      -- Not this business's rental: its link refuses it.
      RETURN NEW;
    END IF;
    IF "rental"."status" <> 'active' OR "rental"."renter_kind" <> 'organisation'
      OR "rental"."driver_id" IS DISTINCT FROM NEW.from_driver_id
    THEN
      RAISE EXCEPTION 'A driver change is for a business''s car that is out, from the driver who has it.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "car_swaps" "swap"
      WHERE "swap"."rental_id" = NEW.rental_id AND "swap"."operator_id" = NEW.operator_id
        AND "swap"."status" = 'in_progress'
    ) THEN
      RAISE EXCEPTION 'The driver can''t change while a car swap is under way.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF (
      SELECT count(*) FROM "inspections" "i"
      WHERE "i"."operator_id" = NEW.operator_id AND "i"."rental_id" = NEW.rental_id
        AND "i"."is_for_driver_change" AND "i"."status" = 'in_progress'
        AND (("i"."id" = NEW.return_inspection_id AND "i"."kind" = 'return')
          OR ("i"."id" = NEW.handover_inspection_id AND "i"."kind" = 'handover'))
    ) <> 2 THEN
      RAISE EXCEPTION 'A driver change has its own return and handover checklists of the rental.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app"."check_car_swap_start"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    PERFORM 1 FROM "rentals"
      WHERE "id" = NEW.rental_id AND "operator_id" = NEW.operator_id
      FOR NO KEY UPDATE;
    IF EXISTS (
      SELECT 1 FROM "rental_driver_changes" "change"
      WHERE "change"."rental_id" = NEW.rental_id AND "change"."operator_id" = NEW.operator_id
        AND "change"."status" = 'in_progress'
    ) THEN
      RAISE EXCEPTION 'A car swap can''t start while a driver change is under way.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint
