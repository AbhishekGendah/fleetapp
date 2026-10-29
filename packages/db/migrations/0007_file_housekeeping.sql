-- The daily clean-up job has no signed-in User (rule 3). It works one
-- Operator at a time, with that Operator's tenant context set, and needs only
-- to know which Operators have work waiting. This function tells it that and
-- nothing else: Operator IDs, never what any file is.
--
-- It runs as the migration owner (SECURITY DEFINER), so the owner gets a
-- read policy on files; the owner owns the table and could disable row-level
-- security anyway, so this exposes nothing new. The Operator app's role may
-- only call the function: it still cannot read another Operator's files.
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY "files_owner_housekeeping_read" ON "files" FOR SELECT TO %I USING (true)',
    current_user
  );
END
$$;--> statement-breakpoint
CREATE FUNCTION "app"."operators_with_file_housekeeping_due"(
  "deleted_before" timestamp with time zone,
  "unfinished_before" timestamp with time zone
) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT DISTINCT "operator_id" FROM "public"."files"
  WHERE ("deleted_at" < "deleted_before" AND "purged_at" IS NULL)
     OR ("confirmed_at" IS NULL AND "refused_at" IS NULL AND "deleted_at" IS NULL
         AND "created_at" < "unfinished_before")
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."operators_with_file_housekeeping_due"(timestamp with time zone, timestamp with time zone) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."operators_with_file_housekeeping_due"(timestamp with time zone, timestamp with time zone) TO "web_app_role";
