-- Retention fixes from the code review (B3).
--
-- Scans approved before migration 0024 still point at their link and
-- submission, so the clean-up can never remove those submissions (a second
-- copy of a date of birth and licence number). They become plain scans of the
-- Renter, as approval now leaves them. Row security is lifted for this one
-- statement only (the owner runs migrations), and only within this
-- migration's transaction.
ALTER TABLE "files" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "files" SET "submission_id" = NULL, "renter_link_id" = NULL
WHERE "purpose" = 'renter_licence_scan'
  AND ("submission_id" IS NOT NULL OR "renter_link_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- A scan due on the 31st must not be missed: the shortest keeping period is
-- a month, so the database never looks later than 28 days ago.
CREATE OR REPLACE FUNCTION "app"."operators_with_licence_scans_added_before"(
  "added_before" timestamp with time zone
) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT DISTINCT "operator_id" FROM "public"."files"
  WHERE "purpose" = 'renter_licence_scan'
    AND "confirmed_at" < least("added_before", now() - interval '28 days')
    AND "deleted_at" IS NULL
$$;
