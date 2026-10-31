-- The Operator's review of what a Renter sent through a link (part 4c).
--
-- Approving turns the submission's two photos into the Renter's licence
-- scans: the same file, now the Renter's, rather than a copy.
GRANT UPDATE ("purpose", "renter_id") ON "files" TO "web_app_role";--> statement-breakpoint
-- A submission never approved is removed with its photos 30 days after its
-- link ended (expired or cancelled), by the daily clean-up. The app may never
-- delete a record (rule 13; the schema guard test checks no app role holds
-- DELETE), so removal is done only by the narrow function below, which runs
-- as the migration owner. The owner gets read and delete policies on
-- renter_submissions for it; the owner owns the table and could disable
-- row-level security anyway, so this exposes nothing new.
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY "renter_submissions_owner_cleanup_read" ON "renter_submissions" FOR SELECT TO %I USING (true)',
    current_user
  );
  EXECUTE format(
    'CREATE POLICY "renter_submissions_owner_cleanup_delete" ON "renter_submissions" FOR DELETE TO %I USING (true)',
    current_user
  );
END
$$;--> statement-breakpoint
-- Which Operators have a link that ended before the cutoff with an
-- unapproved submission or photos still held. Operator IDs only, never what
-- was sent, so the job can then work one Operator at a time (rule 3).
CREATE FUNCTION "app"."operators_with_abandoned_renter_submissions"(
  "ended_before" timestamp with time zone
) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT DISTINCT "l"."operator_id" FROM "public"."renter_links" "l"
  WHERE least("l"."expires_at", "l"."cancelled_at") < "ended_before"
    AND (
      EXISTS (
        SELECT 1 FROM "public"."renter_submissions" "s"
        WHERE "s"."link_id" = "l"."id" AND "s"."operator_id" = "l"."operator_id"
          AND "s"."status" <> 'approved'
      )
      OR EXISTS (
        SELECT 1 FROM "public"."files" "f"
        WHERE "f"."renter_link_id" = "l"."id" AND "f"."operator_id" = "l"."operator_id"
          AND "f"."purpose" = 'renter_submitted_scan' AND "f"."deleted_at" IS NULL
      )
    )
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."operators_with_abandoned_renter_submissions"(timestamp with time zone) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."operators_with_abandoned_renter_submissions"(timestamp with time zone) TO "web_app_role";--> statement-breakpoint
-- Removes the current Operator's unapproved submissions whose link ended
-- before the cutoff: only the Operator set for this transaction (withTenant),
-- and only once the app has already taken their photos off (no file still
-- points at them). Returns what went, for the log.
CREATE FUNCTION "app"."delete_abandoned_renter_submissions"(
  "ended_before" timestamp with time zone
) RETURNS TABLE ("submission_id" uuid, "renter_id" uuid)
  LANGUAGE sql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  DELETE FROM "public"."renter_submissions" "s"
  USING "public"."renter_links" "l"
  WHERE "s"."operator_id" = "app"."current_operator_id"()
    AND "l"."id" = "s"."link_id" AND "l"."operator_id" = "s"."operator_id"
    AND "s"."status" <> 'approved'
    AND least("l"."expires_at", "l"."cancelled_at") < "ended_before"
    AND NOT EXISTS (
      SELECT 1 FROM "public"."files" "f"
      WHERE "f"."submission_id" = "s"."id" AND "f"."operator_id" = "s"."operator_id"
    )
  RETURNING "s"."id", "s"."renter_id"
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."delete_abandoned_renter_submissions"(timestamp with time zone) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."delete_abandoned_renter_submissions"(timestamp with time zone) TO "web_app_role";
