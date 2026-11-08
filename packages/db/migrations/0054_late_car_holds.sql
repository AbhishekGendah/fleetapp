-- Find a car, decision 5 (docs/plans/find-a-car.md, approved by Abhi on
-- 8 Nov 2026): a car still out past its rental's planned end is not free
-- until it is returned. That rental's hold ends at the planned end, so the
-- no-overlap rule (0028) let another booking take the car from then, and
-- only the next handover was refused, by the possessions rule (0033). Now a
-- new hold is refused while any other rental has the car out and is past its
-- planned end, if the hold reaches past that end: as if the late rental's
-- hold ran on with no end until the return.
--
-- Never refused: a hold being let go; the late rental's own holds (a new
-- end, a swap); and a live hold that already reached past that end before
-- this change (a booking made before the car was late), so the Operator can
-- still move, shorten or cancel it. Nothing here reads or changes existing
-- rows, so a filled database updates at once, and existing bookings stay.
-- The refusal uses the exclusion-rule error the deployed code already reads
-- as "the car was taken", under its own name.
CREATE FUNCTION "app"."check_car_hold_not_while_out"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  DECLARE
    "due_back" timestamptz;
  BEGIN
    IF NEW.released_at IS NOT NULL THEN
      RETURN NEW;
    END IF;
    SELECT "r"."planned_end" INTO "due_back"
      FROM "possessions" "p"
      JOIN "rentals" "r" ON "r"."id" = "p"."rental_id" AND "r"."operator_id" = "p"."operator_id"
      WHERE "p"."operator_id" = NEW.operator_id
        AND "p"."vehicle_id" = NEW.vehicle_id
        AND "p"."ended_at" IS NULL
        AND "p"."rental_id" <> NEW.rental_id
        AND "r"."planned_end" < now()
        AND NEW.held_during && tstzrange("r"."planned_end", NULL, '[)')
      LIMIT 1;
    IF NOT FOUND THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE'
      AND OLD.released_at IS NULL
      AND OLD.vehicle_id = NEW.vehicle_id
      AND OLD.rental_id = NEW.rental_id
      AND OLD.held_during && tstzrange("due_back", NULL, '[)')
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'This car is still out past its return date: it can''t be booked until it is back.'
      USING ERRCODE = 'exclusion_violation', CONSTRAINT = 'car_holds_not_while_out';
  END;
  $$;--> statement-breakpoint
CREATE TRIGGER "car_holds_not_while_out"
  BEFORE INSERT OR UPDATE OF "held_during", "released_at", "vehicle_id", "rental_id" ON "car_holds"
  FOR EACH ROW EXECUTE FUNCTION "app"."check_car_hold_not_while_out"();
