-- Security fixes from the full code review (docs/reviews/2026-10-31-full-code-review.md).
--
-- A3. A Renter link stops working while its Operator is suspended or archived.
-- The lookup runs as the owner, which gets a read policy on operators for it;
-- the owner owns the table and could disable row-level security anyway.
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY "operators_owner_link_lookup" ON "operators" FOR SELECT TO %I USING (true)',
    current_user
  );
END
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app"."renter_link_for_token"("token_hash" text)
RETURNS TABLE ("operator_id" uuid, "link_id" uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT "l"."operator_id", "l"."id" FROM "public"."renter_links" "l"
  JOIN "public"."operators" "o" ON "o"."id" = "l"."operator_id"
  WHERE "l"."token_hash" = "renter_link_for_token"."token_hash"
    AND "l"."cancelled_at" IS NULL
    AND "l"."expires_at" > now()
    AND "o"."suspended_at" IS NULL
    AND "o"."archived_at" IS NULL
$$;--> statement-breakpoint
-- A5. The clean-up functions no longer trust the cut-off they are given: the
-- database never lets it be later than the rule allows (30 days after a link
-- ended, a deleted file 30 days on, an unfinished upload a day old, a scan a
-- month old), so a mistaken or misused call cannot delete live data or list
-- Operators who hold it. A cut-off earlier than that is still honoured.
CREATE OR REPLACE FUNCTION "app"."operators_with_file_housekeeping_due"(
  "deleted_before" timestamp with time zone,
  "unfinished_before" timestamp with time zone
) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT DISTINCT "operator_id" FROM "public"."files"
  WHERE ("deleted_at" < least("deleted_before", now() - interval '30 days') AND "purged_at" IS NULL)
     OR ("confirmed_at" IS NULL AND "refused_at" IS NULL AND "deleted_at" IS NULL
         AND "created_at" < least("unfinished_before", now() - interval '1 day'))
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app"."operators_with_licence_scans_added_before"(
  "added_before" timestamp with time zone
) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT DISTINCT "operator_id" FROM "public"."files"
  WHERE "purpose" = 'renter_licence_scan'
    AND "confirmed_at" < least("added_before", now() - interval '1 month')
    AND "deleted_at" IS NULL
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app"."operators_with_abandoned_renter_submissions"(
  "ended_before" timestamp with time zone
) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT DISTINCT "l"."operator_id" FROM "public"."renter_links" "l"
  WHERE least("l"."expires_at", "l"."cancelled_at")
          < least("ended_before", now() - interval '30 days')
    AND (
      EXISTS (
        SELECT 1 FROM "public"."renter_submissions" "s"
        WHERE "s"."link_id" = "l"."id" AND "s"."operator_id" = "l"."operator_id"
      )
      OR EXISTS (
        SELECT 1 FROM "public"."files" "f"
        WHERE "f"."renter_link_id" = "l"."id" AND "f"."operator_id" = "l"."operator_id"
          AND "f"."purpose" = 'renter_submitted_scan' AND "f"."deleted_at" IS NULL
      )
    )
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app"."delete_abandoned_renter_submissions"(
  "ended_before" timestamp with time zone
) RETURNS TABLE ("submission_id" uuid, "renter_id" uuid)
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  DELETE FROM "public"."renter_submissions" "s"
  USING "public"."renter_links" "l"
  WHERE "s"."operator_id" = "app"."current_operator_id"()
    AND "l"."id" = "s"."link_id" AND "l"."operator_id" = "s"."operator_id"
    AND least("l"."expires_at", "l"."cancelled_at")
          < least("ended_before", now() - interval '30 days')
    AND NOT EXISTS (
      SELECT 1 FROM "public"."files" "f"
      WHERE "f"."submission_id" = "s"."id" AND "f"."operator_id" = "s"."operator_id"
    )
  RETURNING "s"."id", "s"."renter_id"
$$;--> statement-breakpoint
-- A6. The admin app reads only who did what and when in Operators' history,
-- never the values: rule 5 no longer rests on every line of code
-- remembering to withhold personal details. It still writes its own lines.
REVOKE SELECT ON "activity_log" FROM "admin_app_role";--> statement-breakpoint
GRANT SELECT ("id", "operator_id", "actor_type", "actor_id", "entity_type", "entity_id", "action", "occurred_at") ON "activity_log" TO "admin_app_role";
