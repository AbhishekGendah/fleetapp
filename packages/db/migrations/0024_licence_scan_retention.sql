-- Retention (docs/plans/phase-2-step-5.md).
--
-- Approving a submission now makes its photos plain licence scans of the
-- Renter, unhooked from the link as well as the submission, so they are
-- never mistaken for photos still to send and stay when the submission is
-- cleared away. The log keeps where they came from.
GRANT UPDATE ("renter_link_id") ON "files" TO "web_app_role";--> statement-breakpoint
--
-- Which Operators hold a licence scan added before the cutoff: Operator IDs
-- only, never what any file is (rule 3). The nightly job passes the shortest
-- possible keeping period, then works one Operator at a time with that
-- Operator's own setting. The owner already reads files for the file
-- clean-up (migration 0007).
CREATE FUNCTION "app"."operators_with_licence_scans_added_before"(
  "added_before" timestamp with time zone
) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT DISTINCT "operator_id" FROM "public"."files"
  WHERE "purpose" = 'renter_licence_scan'
    AND "confirmed_at" < "added_before"
    AND "deleted_at" IS NULL
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."operators_with_licence_scans_added_before"(timestamp with time zone) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."operators_with_licence_scans_added_before"(timestamp with time zone) TO "web_app_role";--> statement-breakpoint
-- What a Renter sent is now removed 30 days after their link ended whatever
-- happened to it, approved included: once approved it is on the Renter's
-- record and the log says who sent and approved it, so the second copy of
-- their date of birth and licence number is not kept. Same names and grants;
-- only the "not approved" condition goes.
CREATE OR REPLACE FUNCTION "app"."operators_with_abandoned_renter_submissions"(
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
  SET search_path = pg_catalog, public
AS $$
  DELETE FROM "public"."renter_submissions" "s"
  USING "public"."renter_links" "l"
  WHERE "s"."operator_id" = "app"."current_operator_id"()
    AND "l"."id" = "s"."link_id" AND "l"."operator_id" = "s"."operator_id"
    AND least("l"."expires_at", "l"."cancelled_at") < "ended_before"
    AND NOT EXISTS (
      SELECT 1 FROM "public"."files" "f"
      WHERE "f"."submission_id" = "s"."id" AND "f"."operator_id" = "s"."operator_id"
    )
  RETURNING "s"."id", "s"."renter_id"
$$;
