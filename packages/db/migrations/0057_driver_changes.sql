-- Business Renters, Migration C (docs/plans/business-renters.md, slice 4,
-- approved by Abhi on 9 Nov 2026): a business's driver changes while its car
-- is out. The car is checked in from the driver who has it (a return
-- checklist) and signed for by the new driver (a handover checklist); one
-- possession ends and the next starts at that signature (rule 15). Safe with
-- the code deployed before it: a new table it never reads, a new checklist
-- column whose default is what it always meant, the finished-checklist index
-- widened only for rows it never writes, and the driver rule tightened only
-- for a car that is out, whose driver that code can't change anyway.
CREATE TYPE "public"."driver_change_status" AS ENUM('in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "rental_driver_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"rental_id" uuid NOT NULL,
	"from_driver_id" uuid NOT NULL,
	"to_driver_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" "driver_change_status" DEFAULT 'in_progress' NOT NULL,
	"return_inspection_id" uuid NOT NULL,
	"handover_inspection_id" uuid NOT NULL,
	"changed_at" timestamp with time zone,
	"started_by_user_id" uuid NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rental_driver_changes_id_operator_unique" UNIQUE("id","operator_id"),
	CONSTRAINT "rental_driver_changes_other_driver" CHECK ("rental_driver_changes"."from_driver_id" <> "rental_driver_changes"."to_driver_id"),
	CONSTRAINT "rental_driver_changes_reason" CHECK (length(trim("rental_driver_changes"."reason")) > 0),
	CONSTRAINT "rental_driver_changes_completed" CHECK (("rental_driver_changes"."status" = 'completed') = ("rental_driver_changes"."changed_at" is not null)),
	CONSTRAINT "rental_driver_changes_cancelled" CHECK (("rental_driver_changes"."status" = 'cancelled') = ("rental_driver_changes"."cancelled_at" is not null))
);
--> statement-breakpoint
DROP INDEX "inspections_one_completed";--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "is_for_driver_change" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rental_driver_changes" ADD CONSTRAINT "rental_driver_changes_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_driver_changes" ADD CONSTRAINT "rental_driver_changes_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_driver_changes" ADD CONSTRAINT "rental_driver_changes_rental_fk" FOREIGN KEY ("rental_id","operator_id") REFERENCES "public"."rentals"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_driver_changes" ADD CONSTRAINT "rental_driver_changes_from_driver_fk" FOREIGN KEY ("from_driver_id","operator_id") REFERENCES "public"."renters"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_driver_changes" ADD CONSTRAINT "rental_driver_changes_to_driver_fk" FOREIGN KEY ("to_driver_id","operator_id") REFERENCES "public"."renters"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_driver_changes" ADD CONSTRAINT "rental_driver_changes_return_inspection_fk" FOREIGN KEY ("return_inspection_id","operator_id") REFERENCES "public"."inspections"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_driver_changes" ADD CONSTRAINT "rental_driver_changes_handover_inspection_fk" FOREIGN KEY ("handover_inspection_id","operator_id") REFERENCES "public"."inspections"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rental_driver_changes_rental_idx" ON "rental_driver_changes" USING btree ("operator_id","rental_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rental_driver_changes_one_in_progress" ON "rental_driver_changes" USING btree ("operator_id","rental_id") WHERE "rental_driver_changes"."status" = 'in_progress';--> statement-breakpoint
CREATE UNIQUE INDEX "inspections_one_completed" ON "inspections" USING btree ("operator_id","rental_id","kind") WHERE "inspections"."status" = 'completed' and not "inspections"."is_for_swap" and not "inspections"."is_for_driver_change";--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_one_pair" CHECK (not ("inspections"."is_for_swap" and "inspections"."is_for_driver_change"));--> statement-breakpoint
-- A finished or cancelled driver change is history: nothing on it changes again.
CREATE FUNCTION "app"."keep_finished_driver_change"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF OLD.status <> 'in_progress' THEN
      RAISE EXCEPTION 'A % driver change cannot change.', OLD.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint
CREATE TRIGGER "rental_driver_changes_finished_kept"
  BEFORE UPDATE ON "rental_driver_changes"
  FOR EACH ROW EXECUTE FUNCTION "app"."keep_finished_driver_change"();--> statement-breakpoint
CREATE TRIGGER "rental_driver_changes_no_delete"
  BEFORE DELETE ON "rental_driver_changes"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "rental_driver_changes_no_truncate"
  BEFORE TRUNCATE ON "rental_driver_changes"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint

-- A driver change starts only for a business's car that is out, from the
-- driver who has it, with its own two checklists under way, and never while
-- a car swap is (and the reverse, below). The rental is locked first, as
-- everything else that changes a rental does ("Lock order"), so two starts
-- at the same moment run one after the other.
CREATE FUNCTION "app"."check_driver_change_start"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  DECLARE
    "rental" record;
  BEGIN
    SELECT "r"."status", "r"."driver_id", "k"."kind" AS "renter_kind" INTO "rental"
      FROM "rentals" "r"
      INNER JOIN "renters" "k" ON "k"."id" = "r"."renter_id" AND "k"."operator_id" = "r"."operator_id"
      WHERE "r"."id" = NEW.rental_id AND "r"."operator_id" = NEW.operator_id
      FOR UPDATE OF "r";
    IF NOT FOUND THEN
      -- Not this business's rental: its link refuses it.
      RETURN NEW;
    END IF;
    IF "rental"."status" <> 'active' OR "rental"."renter_kind" <> 'organisation'
      OR "rental"."driver_id" IS DISTINCT FROM NEW.from_driver_id
    THEN
      RAISE EXCEPTION 'A driver change is for a business''s car that is out, from the driver who has it.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "car_swaps" "swap"
      WHERE "swap"."rental_id" = NEW.rental_id AND "swap"."operator_id" = NEW.operator_id
        AND "swap"."status" = 'in_progress'
    ) THEN
      RAISE EXCEPTION 'The driver can''t change while a car swap is under way.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF (
      SELECT count(*) FROM "inspections" "i"
      WHERE "i"."operator_id" = NEW.operator_id AND "i"."rental_id" = NEW.rental_id
        AND "i"."is_for_driver_change" AND "i"."status" = 'in_progress'
        AND (("i"."id" = NEW.return_inspection_id AND "i"."kind" = 'return')
          OR ("i"."id" = NEW.handover_inspection_id AND "i"."kind" = 'handover'))
    ) <> 2 THEN
      RAISE EXCEPTION 'A driver change has its own return and handover checklists of the rental.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint
CREATE TRIGGER "rental_driver_changes_start"
  BEFORE INSERT ON "rental_driver_changes"
  FOR EACH ROW EXECUTE FUNCTION "app"."check_driver_change_start"();--> statement-breakpoint

-- No car swap starts while a driver change is under way. The code deployed
-- before this never starts a driver change, so nothing it does is refused.
CREATE FUNCTION "app"."check_car_swap_start"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    PERFORM 1 FROM "rentals"
      WHERE "id" = NEW.rental_id AND "operator_id" = NEW.operator_id
      FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM "rental_driver_changes" "change"
      WHERE "change"."rental_id" = NEW.rental_id AND "change"."operator_id" = NEW.operator_id
        AND "change"."status" = 'in_progress'
    ) THEN
      RAISE EXCEPTION 'A car swap can''t start while a driver change is under way.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint
CREATE TRIGGER "car_swaps_start"
  BEFORE INSERT ON "car_swaps"
  FOR EACH ROW EXECUTE FUNCTION "app"."check_car_swap_start"();--> statement-breakpoint

-- Once the car is out, the driver changes only to the new driver of the
-- driver change under way, from the one it started from (the rest of the
-- rule as in 0052). The trigger itself is unchanged.
CREATE OR REPLACE FUNCTION "app"."check_rental_driver"() RETURNS trigger
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
      IF OLD.status IN ('returned', 'closed', 'cancelled')
        OR NEW.status IN ('returned', 'closed', 'cancelled')
      THEN
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
      IF OLD.status = 'active' AND NOT EXISTS (
        SELECT 1 FROM "rental_driver_changes" "change"
        WHERE "change"."rental_id" = NEW.id AND "change"."operator_id" = NEW.operator_id
          AND "change"."status" = 'in_progress'
          AND "change"."from_driver_id" = OLD.driver_id AND "change"."to_driver_id" = NEW.driver_id
      ) THEN
        RAISE EXCEPTION 'Once the car is out, the driver changes only through a driver change under way.'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint

-- Each business's own, and the Operator app's only: the admin logins get nothing (rule 5).
ALTER TABLE "rental_driver_changes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rental_driver_changes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "rental_driver_changes" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("status", "changed_at", "cancelled_at", "updated_at") ON "rental_driver_changes"
  TO "web_app_role";--> statement-breakpoint
CREATE POLICY "rental_driver_changes_web_tenant" ON "rental_driver_changes" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());
