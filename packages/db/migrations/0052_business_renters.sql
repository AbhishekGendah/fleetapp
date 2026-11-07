-- Business Renters, slice 1 (docs/plans/business-renters.md, Migration A,
-- approved by Abhi 7 Nov 2026). Runs on a filled database while the code
-- already deployed keeps working: every existing Renter becomes a person,
-- every rental and possession gets its driver (the Renter), and the triggers
-- below fill the driver in for code that doesn't name one yet.

-- 1. A Renter is a person or a business. A constant default fills every
-- existing row at once, without rewriting the table: all are people.
CREATE TYPE "public"."renter_kind" AS ENUM('person', 'organisation');--> statement-breakpoint
ALTER TABLE "renters" ADD COLUMN "kind" "renter_kind" DEFAULT 'person' NOT NULL;--> statement-breakpoint

-- 2. A business's own details. Its legal name is full_name, and phone and
-- email are its contact's.
ALTER TABLE "renters" ADD COLUMN "trading_name" text;--> statement-breakpoint
ALTER TABLE "renters" ADD COLUMN "abn" text;--> statement-breakpoint
ALTER TABLE "renters" ADD COLUMN "contact_name" text;--> statement-breakpoint
ALTER TABLE "renters" ADD COLUMN "business_address" text;--> statement-breakpoint

-- 3. Checks. The ATO's ABN checksum, as in packages/core/src/abn.ts: take 1
-- from the first digit, weight the digits, and the total divides by 89. The
-- app checks it as typed and on save (rule 31); this stops a bad import.
CREATE FUNCTION "app"."is_valid_abn"("abn" text) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
  SET search_path = pg_catalog, pg_temp
AS $$
  DECLARE
    "weights" constant int[] := ARRAY[10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
    "total" int := 0;
  BEGIN
    IF "abn" IS NULL OR "abn" !~ '^[0-9]{11}$' THEN
      RETURN false;
    END IF;
    FOR "position" IN 1..11 LOOP
      "total" := "total" + "weights"["position"]
        * (substr("abn", "position", 1)::int - CASE WHEN "position" = 1 THEN 1 ELSE 0 END);
    END LOOP;
    RETURN "total" % 89 = 0;
  END;
$$;--> statement-breakpoint
ALTER TABLE "renters" ADD CONSTRAINT "renters_kind_fields" CHECK (("renters"."kind" = 'person'
          and num_nonnulls("renters"."trading_name", "renters"."contact_name", "renters"."business_address") = 0)
        or ("renters"."kind" = 'organisation'
          and num_nonnulls("renters"."date_of_birth", "renters"."preferred_name", "renters"."residential_address",
            "renters"."emergency_contact_name", "renters"."emergency_contact_phone",
            "renters"."emergency_contact_relationship", "renters"."licence_issued_in", "renters"."licence_country",
            "renters"."licence_number", "renters"."licence_class", "renters"."licence_type",
            "renters"."licence_expires_on") = 0));--> statement-breakpoint
ALTER TABLE "renters" ADD CONSTRAINT "renters_abn_shape" CHECK ("renters"."abn" is null or "renters"."abn" ~ '^[0-9]{11}$');--> statement-breakpoint
ALTER TABLE "renters" ADD CONSTRAINT "renters_abn_checksum" CHECK ("renters"."abn" is null or app.is_valid_abn("renters"."abn"));--> statement-breakpoint
ALTER TABLE "renters" ADD CONSTRAINT "renters_organisation_email" CHECK ("renters"."retired_at" is not null or "renters"."kind" <> 'organisation' or "renters"."email" is not null);--> statement-breakpoint

-- 4. The business's details can be edited; its kind never can (no grant):
-- it would change the meaning of every rental and document it has.
GRANT UPDATE ("trading_name", "abn", "contact_name", "business_address") ON "renters" TO "web_app_role";--> statement-breakpoint

-- 5. Which people drive for which business.
CREATE TABLE "organisation_drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"organisation_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"added_by_user_id" uuid NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisation_drivers_not_self" CHECK ("organisation_drivers"."organisation_id" <> "organisation_drivers"."driver_id"),
	CONSTRAINT "organisation_drivers_removed" CHECK (("organisation_drivers"."removed_by_user_id" is null or "organisation_drivers"."removed_at" is not null)
        and ("organisation_drivers"."removed_at" is null or "organisation_drivers"."removed_at" >= "organisation_drivers"."added_at"))
);
--> statement-breakpoint
ALTER TABLE "organisation_drivers" ADD CONSTRAINT "organisation_drivers_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_drivers" ADD CONSTRAINT "organisation_drivers_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_drivers" ADD CONSTRAINT "organisation_drivers_removed_by_user_id_users_id_fk" FOREIGN KEY ("removed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_drivers" ADD CONSTRAINT "organisation_drivers_organisation_fk" FOREIGN KEY ("organisation_id","operator_id") REFERENCES "public"."renters"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_drivers" ADD CONSTRAINT "organisation_drivers_driver_fk" FOREIGN KEY ("driver_id","operator_id") REFERENCES "public"."renters"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organisation_drivers_one_current" ON "organisation_drivers" USING btree ("operator_id","organisation_id","driver_id") WHERE "organisation_drivers"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "organisation_drivers_driver_idx" ON "organisation_drivers" USING btree ("operator_id","driver_id");--> statement-breakpoint

-- The business must be one and the driver a person, neither retired. Both
-- are locked (shared) first, so the retention job, which locks a Renter
-- before checking they have no current links, can't retire either meanwhile.
-- The times are the database's: they start the seven-year clock (0047).
CREATE FUNCTION "app"."check_organisation_driver"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  DECLARE
    "organisation" record;
    "driver" record;
  BEGIN
    IF TG_OP = 'UPDATE' THEN
      IF OLD.removed_at IS NOT NULL THEN
        RAISE EXCEPTION 'A driver''s past link to a business is kept as it is.'
          USING ERRCODE = 'restrict_violation';
      END IF;
      IF NEW.removed_at IS NOT NULL AND NOT "app"."runs_as_owner"(TG_RELID) THEN
        NEW.removed_at := now();
      END IF;
      RETURN NEW;
    END IF;
    IF NOT "app"."runs_as_owner"(TG_RELID) THEN
      NEW.added_at := now();
      NEW.removed_at := NULL;
      NEW.removed_by_user_id := NULL;
    END IF;
    SELECT "kind", "retired_at" INTO "organisation" FROM "renters"
      WHERE "id" = NEW.organisation_id AND "operator_id" = NEW.operator_id
      FOR SHARE;
    SELECT "kind", "retired_at" INTO "driver" FROM "renters"
      WHERE "id" = NEW.driver_id AND "operator_id" = NEW.operator_id
      FOR SHARE;
    IF "organisation"."kind" IS DISTINCT FROM 'organisation' OR "driver"."kind" IS DISTINCT FROM 'person' THEN
      RAISE EXCEPTION 'A driver is a person Renter who drives for a business Renter.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF "organisation"."retired_at" IS NOT NULL OR "driver"."retired_at" IS NOT NULL THEN
      RAISE EXCEPTION 'A Renter whose details were removed can''t be given new records.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint
CREATE TRIGGER "organisation_drivers_rules"
  BEFORE INSERT OR UPDATE ON "organisation_drivers"
  FOR EACH ROW EXECUTE FUNCTION "app"."check_organisation_driver"();--> statement-breakpoint
-- Never removed (rule 13): a driver who stops is marked removed, with the history kept.
CREATE TRIGGER "organisation_drivers_not_deleted"
  BEFORE DELETE ON "organisation_drivers"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "organisation_drivers_no_truncate"
  BEFORE TRUNCATE ON "organisation_drivers"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint

-- Each business's own, and the Operator app's only: the admin logins get nothing (rule 5).
ALTER TABLE "organisation_drivers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organisation_drivers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "organisation_drivers" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("removed_at", "removed_by_user_id", "updated_at") ON "organisation_drivers" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "organisation_drivers_web_tenant" ON "organisation_drivers" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint

-- 6. Who drives each rental. Every existing Renter is a person, who drives
-- their own rentals. Row security is lifted for the backfill only (the owner
-- runs migrations), within this migration's transaction, as in 0026.
ALTER TABLE "rentals" ADD COLUMN "driver_id" uuid;--> statement-breakpoint
ALTER TABLE "rentals" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "rentals" SET "driver_id" = "renter_id";--> statement-breakpoint
ALTER TABLE "rentals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_driver_fk" FOREIGN KEY ("driver_id","operator_id") REFERENCES "public"."renters"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rentals_driver_idx" ON "rentals" USING btree ("operator_id","driver_id");--> statement-breakpoint
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_driver_when_out" CHECK ("rentals"."status" not in ('active', 'returned', 'closed') or "rentals"."driver_id" is not null);--> statement-breakpoint
GRANT UPDATE ("driver_id") ON "rentals" TO "web_app_role";--> statement-breakpoint

-- A person drives their own rentals: filled in when not named, which keeps
-- code that names no driver working. A business's driver is one of its
-- current drivers (or none yet, before the car goes), never retired, locked
-- as for the link above. Once the car is out the driver changes only with a
-- new possession signed for by the new driver (slice 4): the old possession
-- ends first, then the driver changes, then the new one starts, all in one
-- transaction; "rentals_driver_has_possession" checks it at the commit.
CREATE FUNCTION "app"."check_rental_driver"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  DECLARE
    "renter_kind" "public"."renter_kind";
    "driver" record;
  BEGIN
    IF TG_OP = 'UPDATE' AND NEW.renter_id IS NOT DISTINCT FROM OLD.renter_id
      AND NEW.driver_id IS NOT DISTINCT FROM OLD.driver_id
    THEN
      RETURN NEW;
    END IF;
    SELECT "kind" INTO "renter_kind" FROM "renters"
      WHERE "id" = NEW.renter_id AND "operator_id" = NEW.operator_id;
    IF "renter_kind" = 'person' THEN
      NEW.driver_id := coalesce(NEW.driver_id, NEW.renter_id);
      IF NEW.driver_id <> NEW.renter_id THEN
        RAISE EXCEPTION 'A person Renter drives their own rentals.'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF "renter_kind" = 'organisation' AND NEW.driver_id IS NOT NULL THEN
      SELECT "kind", "retired_at" INTO "driver" FROM "renters"
        WHERE "id" = NEW.driver_id AND "operator_id" = NEW.operator_id
        FOR SHARE;
      IF "driver"."retired_at" IS NOT NULL THEN
        RAISE EXCEPTION 'A Renter whose details were removed can''t be given new records.'
          USING ERRCODE = 'restrict_violation';
      END IF;
      PERFORM 1 FROM "organisation_drivers"
        WHERE "operator_id" = NEW.operator_id AND "organisation_id" = NEW.renter_id
          AND "driver_id" = NEW.driver_id AND "removed_at" IS NULL
        FOR SHARE;
      IF "driver"."kind" IS DISTINCT FROM 'person' OR NOT FOUND THEN
        RAISE EXCEPTION 'A business''s rental is driven by one of its current drivers.'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
      IF OLD.status IN ('returned', 'closed', 'cancelled') THEN
        RAISE EXCEPTION 'A finished rental keeps its driver.'
          USING ERRCODE = 'check_violation';
      END IF;
      IF EXISTS (
        SELECT 1 FROM "possessions"
        WHERE "rental_id" = NEW.id AND "operator_id" = NEW.operator_id AND "ended_at" IS NULL
      ) THEN
        RAISE EXCEPTION 'The driver changes only with the car brought in and signed for again.'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint
CREATE TRIGGER "rentals_driver_rules"
  BEFORE INSERT OR UPDATE OF "renter_id", "driver_id" ON "rentals"
  FOR EACH ROW EXECUTE FUNCTION "app"."check_rental_driver"();--> statement-breakpoint

-- At the commit of a driver change: a car that is out is with the rental's
-- driver, by a possession the new driver signed for in the same transaction.
CREATE FUNCTION "app"."check_rental_driver_has_possession"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM "rentals" "ra"
      WHERE "ra"."id" = NEW.id AND "ra"."operator_id" = NEW.operator_id AND "ra"."status" = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM "possessions" "p"
          WHERE "p"."rental_id" = "ra"."id" AND "p"."operator_id" = "ra"."operator_id"
            AND "p"."ended_at" IS NULL AND "p"."driver_id" = "ra"."driver_id"
        )
    ) THEN
      RAISE EXCEPTION 'A car that is out is with the rental''s driver, who signed for it.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
  END;
  $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "rentals_driver_has_possession"
  AFTER UPDATE OF "driver_id" ON "rentals"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "app"."check_rental_driver_has_possession"();--> statement-breakpoint

-- 7. Who had the car (rule 15). renter_id stays the rental's Renter (who
-- pays). Every existing possession was a person's own. The possession rule
-- (0033) keeps an ended possession as it is, so it is paused for the
-- backfill only, as is row security.
ALTER TABLE "possessions" ADD COLUMN "driver_id" uuid;--> statement-breakpoint
ALTER TABLE "possessions" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "possessions" DISABLE TRIGGER "possessions_kept";--> statement-breakpoint
UPDATE "possessions" SET "driver_id" = "renter_id";--> statement-breakpoint
ALTER TABLE "possessions" ENABLE TRIGGER "possessions_kept";--> statement-breakpoint
ALTER TABLE "possessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "possessions" ALTER COLUMN "driver_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "possessions" ADD CONSTRAINT "possessions_driver_fk" FOREIGN KEY ("driver_id","operator_id") REFERENCES "public"."renters"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "possessions_driver_idx" ON "possessions" USING btree ("operator_id","driver_id","started_at");--> statement-breakpoint

-- A possession is the rental's Renter's, with the rental's driver at that
-- moment; filled in when not named, which keeps code that names no driver
-- working. The rental is locked (shared) so its driver can't change until
-- this transaction ends, and a car never goes out to a driver not named.
CREATE FUNCTION "app"."check_possession_parties"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  DECLARE
    "rental" record;
  BEGIN
    SELECT "renter_id", "driver_id" INTO "rental" FROM "rentals"
      WHERE "id" = NEW.rental_id AND "operator_id" = NEW.operator_id
      FOR SHARE;
    IF NOT FOUND THEN
      -- Not this business's rental: its link refuses it.
      RETURN NEW;
    END IF;
    IF "rental"."driver_id" IS NULL THEN
      RAISE EXCEPTION 'A car goes out only to a named driver.'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.driver_id := coalesce(NEW.driver_id, "rental"."driver_id");
    IF NEW.driver_id <> "rental"."driver_id" OR NEW.renter_id IS DISTINCT FROM "rental"."renter_id" THEN
      RAISE EXCEPTION 'A possession is the rental''s Renter''s, with the rental''s driver.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint
CREATE TRIGGER "possessions_parties"
  BEFORE INSERT ON "possessions"
  FOR EACH ROW EXECUTE FUNCTION "app"."check_possession_parties"();
