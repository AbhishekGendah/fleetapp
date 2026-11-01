-- Custom SQL migration file, put your code below! ---- Only a confirmed issued document's file is kept for good. One still being
-- saved (its PDF not yet in storage) may be cleaned up like any abandoned
-- upload if saving fails, so nothing half-made is left behind.
CREATE OR REPLACE FUNCTION "app"."keep_issued_document_files"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF OLD.purpose::text = 'issued_document' AND OLD.confirmed_at IS NOT NULL AND (
      TG_OP = 'DELETE'
      OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
      OR NEW.purged_at IS DISTINCT FROM OLD.purged_at
      OR NEW.object_key IS DISTINCT FROM OLD.object_key
      OR NEW.purpose IS DISTINCT FROM OLD.purpose
      OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
    ) THEN
      RAISE EXCEPTION 'An issued document''s file is kept for good.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END;
  $$;
