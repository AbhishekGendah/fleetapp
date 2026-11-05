-- AGS's car-model fixes (review A9-9). As in 0010, except that a car archived
-- by its business is left as it is: an archived car is read-only (rule 13).
CREATE OR REPLACE FUNCTION "app"."correct_vehicle_make_model"(
  "target_vehicle_id" uuid,
  "new_make" text,
  "new_model" text,
  "admin_user_id" uuid
) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  "car" record;
BEGIN
  IF "new_make" IS NULL OR "new_model" IS NULL
     OR length(btrim("new_make")) NOT BETWEEN 1 AND 200
     OR length(btrim("new_model")) NOT BETWEEN 1 AND 200
     OR "new_make" ~ '[[:cntrl:]]' OR "new_model" ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'A make and model of 1 to 200 characters on one line are required.'
      USING ERRCODE = '22023';
  END IF;
  SELECT "id", "operator_id", "make", "model" INTO "car"
  FROM "public"."vehicles"
  WHERE "id" = "target_vehicle_id" AND "archived_at" IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF "car"."make" = btrim("new_make") AND "car"."model" = btrim("new_model") THEN
    RETURN true;
  END IF;
  UPDATE "public"."vehicles"
  SET "make" = btrim("new_make"), "model" = btrim("new_model"), "updated_at" = now()
  WHERE "id" = "car"."id";
  INSERT INTO "public"."activity_log"
    ("operator_id", "actor_type", "actor_id", "entity_type", "entity_id", "action", "values_before", "values_after")
  VALUES (
    "car"."operator_id", 'admin', "admin_user_id", 'vehicle', "car"."id", 'updated',
    jsonb_build_object('make', "car"."make", 'model', "car"."model"),
    jsonb_build_object('make', btrim("new_make"), 'model', btrim("new_model"))
  );
  RETURN true;
END
$$;--> statement-breakpoint

-- "Fix all N cars typed this way" (batch 7 decision 13): every current car
-- typed exactly like the given one and not in the list (as
-- vehicles_not_in_catalogue finds them), each corrected (and logged in its
-- own business's history) one at a time through the function above, unless
-- it already reads so. The cars changed, for AGS's history. The spelling is
-- read from the car, never taken from the request.
CREATE FUNCTION "app"."correct_vehicles_typed_like"(
  "example_vehicle_id" uuid,
  "new_make" text,
  "new_model" text,
  "admin_user_id" uuid
) RETURNS SETOF uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  "example" record;
  "car_id" uuid;
BEGIN
  SELECT "make", "model" INTO "example"
  FROM "public"."vehicles" WHERE "id" = "example_vehicle_id" AND "archived_at" IS NULL;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  FOR "car_id" IN
    SELECT "v"."id" FROM "public"."vehicles" "v"
    WHERE "v"."make" = "example"."make" AND "v"."model" = "example"."model"
      AND "v"."archived_at" IS NULL
      AND ("v"."make", "v"."model") IS DISTINCT FROM (btrim("new_make"), btrim("new_model"))
      AND NOT EXISTS (
        SELECT 1 FROM "public"."vehicle_models" "mo"
        JOIN "public"."vehicle_makes" "ma" ON "ma"."id" = "mo"."make_id"
        WHERE "ma"."name" = "v"."make" AND "mo"."name" = "v"."model"
          AND "ma"."hidden_at" IS NULL AND "mo"."hidden_at" IS NULL
      )
    ORDER BY "v"."id"
  LOOP
    IF "app"."correct_vehicle_make_model"("car_id", "new_make", "new_model", "admin_user_id") THEN
      RETURN NEXT "car_id";
    END IF;
  END LOOP;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."correct_vehicles_typed_like"(uuid, text, text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."correct_vehicles_typed_like"(uuid, text, text, uuid) TO "admin_app_role";
