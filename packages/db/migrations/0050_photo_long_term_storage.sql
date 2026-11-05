ALTER TABLE "files" ADD COLUMN "long_term_storage_at" timestamp with time zone;--> statement-breakpoint
-- Photos from rentals back over a year move to cheaper long-term storage
-- (rule 23, review A7-4); the nightly job records the move here.
GRANT UPDATE ("long_term_storage_at") ON "files" TO "web_app_role";--> statement-breakpoint

-- Row-level security binds the owner too (0047). As there, it gets a read of
-- checklists, so the look-up below can find which businesses have photos due
-- (Operator IDs only); files and rentals it can read already (0007, 0047).
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY %I ON %I FOR SELECT TO %I USING (true)',
    'inspections_owner_jobs_read', 'inspections', current_user
  );
END
$$;--> statement-breakpoint

-- Which businesses have checklist photos (and their small copies) of a rental
-- returned before the given time still in standard storage: IDs only, as the
-- other nightly look-ups (0025). Never earlier than a year ago, whatever is asked.
CREATE FUNCTION "app"."operators_with_photos_for_long_term_storage"(
  "returned_before" timestamp with time zone
) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT DISTINCT "f"."operator_id" FROM "public"."files" "f"
  JOIN "public"."inspections" "i" ON "i"."id" = "f"."inspection_id" AND "i"."operator_id" = "f"."operator_id"
  JOIN "public"."rentals" "r" ON "r"."id" = "i"."rental_id" AND "r"."operator_id" = "i"."operator_id"
  WHERE "f"."purpose" IN ('vehicle_photo', 'vehicle_photo_thumbnail')
    AND "f"."confirmed_at" IS NOT NULL
    AND "f"."deleted_at" IS NULL
    AND "f"."long_term_storage_at" IS NULL
    AND "r"."returned_at" < least("returned_before", now() - interval '1 year')
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."operators_with_photos_for_long_term_storage"(timestamp with time zone) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."operators_with_photos_for_long_term_storage"(timestamp with time zone) TO "web_app_role";
