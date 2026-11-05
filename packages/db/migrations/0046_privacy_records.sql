ALTER TABLE "operators" ADD COLUMN "privacy_policy_url" text;--> statement-breakpoint

-- The business sets its own privacy policy link (review G8-3).
GRANT UPDATE ("privacy_policy_url") ON "operators" TO "web_app_role";--> statement-breakpoint

-- The admin app still gives a new business its name only (as in 0044).
CREATE OR REPLACE FUNCTION "app"."check_admin_operator_insert"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF current_user = 'admin_app_role' AND (
    NEW.abn IS NOT NULL OR NEW.gst_registered OR NEW.gst_registered_from IS NOT NULL
    OR NEW.address_line1 IS NOT NULL OR NEW.address_line2 IS NOT NULL OR NEW.suburb IS NOT NULL
    OR NEW.state IS NOT NULL OR NEW.postcode IS NOT NULL OR NEW.phone IS NOT NULL
    OR NEW.email IS NOT NULL OR NEW.privacy_policy_url IS NOT NULL OR NEW.logo_file_key IS NOT NULL
    -- The column's own default (DEFAULT_TIMEZONE in packages/core).
    OR NEW.timezone <> 'Australia/Perth'
    OR NEW.stripe_account_id IS NOT NULL OR NEW.stripe_charges_enabled
    OR NEW.stripe_payouts_enabled OR NEW.stripe_becs_capability_status IS NOT NULL
    OR NEW.subscription_status <> 'trial' OR NEW.suspended_at IS NOT NULL
    OR NEW.archived_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'The admin app may give a new business its name only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- A photo binned while its checklist was open (a retake) can be removed for
-- good 30 days later, though the checklist has since been finished: only its
-- purged_at changes (review A1-1). The photos the finished checklist kept stay
-- locked, and the rest is as in 0045.
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
  $$;
