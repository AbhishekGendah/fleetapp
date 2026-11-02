CREATE TYPE "public"."fuel_level" AS ENUM('empty', 'quarter', 'half', 'three_quarters', 'full');--> statement-breakpoint
CREATE TYPE "public"."inspection_kind" AS ENUM('handover', 'return');--> statement-breakpoint
CREATE TYPE "public"."inspection_status" AS ENUM('in_progress', 'completed', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."vehicle_status" ADD VALUE 'rented';--> statement-breakpoint
CREATE TABLE "inspection_damage_marks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"inspection_id" uuid NOT NULL,
	"x" smallint NOT NULL,
	"y" smallint NOT NULL,
	"description" text NOT NULL,
	"removed_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inspection_damage_marks_id_operator_unique" UNIQUE("id","operator_id"),
	CONSTRAINT "inspection_damage_marks_position" CHECK ("inspection_damage_marks"."x" between 0 and 1000
        and "inspection_damage_marks"."y" between 0 and 1000)
);
--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"rental_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"kind" "inspection_kind" NOT NULL,
	"status" "inspection_status" DEFAULT 'in_progress' NOT NULL,
	"photo_names" text[] NOT NULL,
	"odometer_km" integer,
	"fuel_level" "fuel_level",
	"keys_count" smallint,
	"accessories" text,
	"notes" text,
	"bond_override_reason" text,
	"started_by_user_id" uuid NOT NULL,
	"acceptance_text" text,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inspections_id_operator_unique" UNIQUE("id","operator_id"),
	CONSTRAINT "inspections_odometer" CHECK ("inspections"."odometer_km" is null or "inspections"."odometer_km" >= 0),
	CONSTRAINT "inspections_keys" CHECK ("inspections"."keys_count" is null or "inspections"."keys_count" between 1 and 9),
	CONSTRAINT "inspections_completed" CHECK (("inspections"."status" = 'completed') = ("inspections"."completed_at" is not null)
        and ("inspections"."status" <> 'completed' or ("inspections"."odometer_km" is not null
          and "inspections"."fuel_level" is not null and "inspections"."keys_count" is not null
          and "inspections"."acceptance_text" is not null))),
	CONSTRAINT "inspections_cancelled" CHECK (("inspections"."status" = 'cancelled') = ("inspections"."cancelled_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "possessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"rental_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"renter_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"held_during" "tstzrange" GENERATED ALWAYS AS (tstzrange(started_at, ended_at, '[)')) STORED,
	"handover_inspection_id" uuid NOT NULL,
	"return_inspection_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "possessions_period" CHECK ("possessions"."ended_at" is null or "possessions"."ended_at" > "possessions"."started_at")
);
--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "inspection_id" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "inspection_photo_name" text;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "damage_mark_id" uuid;--> statement-breakpoint
ALTER TABLE "issued_documents" ADD COLUMN "inspection_id" uuid;--> statement-breakpoint
ALTER TABLE "inspection_damage_marks" ADD CONSTRAINT "inspection_damage_marks_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_damage_marks" ADD CONSTRAINT "inspection_damage_marks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_damage_marks" ADD CONSTRAINT "inspection_damage_marks_inspection_fk" FOREIGN KEY ("inspection_id","operator_id") REFERENCES "public"."inspections"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_rental_fk" FOREIGN KEY ("rental_id","operator_id") REFERENCES "public"."rentals"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_vehicle_fk" FOREIGN KEY ("vehicle_id","operator_id") REFERENCES "public"."vehicles"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "possessions" ADD CONSTRAINT "possessions_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "possessions" ADD CONSTRAINT "possessions_rental_fk" FOREIGN KEY ("rental_id","operator_id") REFERENCES "public"."rentals"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "possessions" ADD CONSTRAINT "possessions_vehicle_fk" FOREIGN KEY ("vehicle_id","operator_id") REFERENCES "public"."vehicles"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "possessions" ADD CONSTRAINT "possessions_renter_fk" FOREIGN KEY ("renter_id","operator_id") REFERENCES "public"."renters"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "possessions" ADD CONSTRAINT "possessions_handover_fk" FOREIGN KEY ("handover_inspection_id","operator_id") REFERENCES "public"."inspections"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "possessions" ADD CONSTRAINT "possessions_return_fk" FOREIGN KEY ("return_inspection_id","operator_id") REFERENCES "public"."inspections"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inspection_damage_marks_inspection_idx" ON "inspection_damage_marks" USING btree ("operator_id","inspection_id");--> statement-breakpoint
CREATE INDEX "inspections_rental_idx" ON "inspections" USING btree ("operator_id","rental_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspections_one_in_progress" ON "inspections" USING btree ("operator_id","rental_id","kind") WHERE "inspections"."status" = 'in_progress';--> statement-breakpoint
CREATE UNIQUE INDEX "inspections_one_completed" ON "inspections" USING btree ("operator_id","rental_id","kind") WHERE "inspections"."status" = 'completed';--> statement-breakpoint
CREATE INDEX "possessions_vehicle_idx" ON "possessions" USING btree ("operator_id","vehicle_id","started_at");--> statement-breakpoint
CREATE INDEX "possessions_rental_idx" ON "possessions" USING btree ("operator_id","rental_id");--> statement-breakpoint
CREATE UNIQUE INDEX "possessions_one_open_per_rental" ON "possessions" USING btree ("operator_id","rental_id") WHERE "possessions"."ended_at" is null;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_inspection_fk" FOREIGN KEY ("inspection_id","operator_id") REFERENCES "public"."inspections"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_damage_mark_fk" FOREIGN KEY ("damage_mark_id","operator_id") REFERENCES "public"."inspection_damage_marks"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_inspection_fk" FOREIGN KEY ("inspection_id","operator_id") REFERENCES "public"."inspections"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "files_one_inspection_photo" ON "files" USING btree ("operator_id","inspection_id","inspection_photo_name") WHERE "files"."inspection_photo_name" is not null and "files"."confirmed_at" is not null and "files"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "files_one_damage_photo" ON "files" USING btree ("operator_id","damage_mark_id") WHERE "files"."damage_mark_id" is not null and "files"."confirmed_at" is not null and "files"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_inspection_photos" CHECK (("files"."inspection_id" is null or "files"."purpose"::text = 'vehicle_photo')
        and ("files"."inspection_photo_name" is null or "files"."inspection_id" is not null)
        and ("files"."damage_mark_id" is null or "files"."inspection_id" is not null)
        and ("files"."inspection_photo_name" is null or "files"."damage_mark_id" is null));--> statement-breakpoint
ALTER TABLE "issued_documents" ADD CONSTRAINT "issued_documents_report_inspection" CHECK (("issued_documents"."kind"::text in ('handover_report', 'return_report')) = ("issued_documents"."inspection_id" is not null));--> statement-breakpoint

-- Two possessions of one car may never overlap (rule 15): one car, one
-- Renter at a time. An open possession runs on without end.
ALTER TABLE "possessions" ADD CONSTRAINT "possessions_no_overlap"
  EXCLUDE USING gist ("operator_id" WITH =, "vehicle_id" WITH =, "held_during" WITH &&);--> statement-breakpoint

-- A checklist is filled in while in progress; once completed or cancelled
-- it is fixed (rule 12), and it is never removed.
CREATE FUNCTION "app"."keep_finished_inspection"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' OR OLD.status <> 'in_progress' THEN
      RAISE EXCEPTION 'A finished checklist is kept as it is.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint
CREATE TRIGGER "inspections_kept"
  BEFORE UPDATE OR DELETE ON "inspections"
  FOR EACH ROW EXECUTE FUNCTION "app"."keep_finished_inspection"();--> statement-breakpoint

-- Damage marks, and checklist photos, belong to a checklist still in
-- progress: none is added, changed or binned once it is finished.
CREATE FUNCTION "app"."is_inspection_in_progress"(target uuid) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog, public, pg_temp
  AS $$ SELECT EXISTS (SELECT 1 FROM "inspections" WHERE id = target AND status = 'in_progress') $$;--> statement-breakpoint
CREATE FUNCTION "app"."keep_finished_damage_marks"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF TG_OP = 'DELETE'
      OR NOT "app"."is_inspection_in_progress"(CASE WHEN TG_OP = 'INSERT' THEN NEW.inspection_id ELSE OLD.inspection_id END)
    THEN
      RAISE EXCEPTION 'Damage marks change only while the checklist is in progress.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint
CREATE TRIGGER "inspection_damage_marks_kept"
  BEFORE INSERT OR UPDATE OR DELETE ON "inspection_damage_marks"
  FOR EACH ROW EXECUTE FUNCTION "app"."keep_finished_damage_marks"();--> statement-breakpoint
CREATE FUNCTION "app"."keep_finished_inspection_photos"() RETURNS trigger
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
  $$;--> statement-breakpoint
CREATE TRIGGER "files_inspection_photos_kept"
  BEFORE INSERT OR UPDATE OR DELETE ON "files"
  FOR EACH ROW EXECUTE FUNCTION "app"."keep_finished_inspection_photos"();--> statement-breakpoint

-- A possession only ever ends, once: its start and its car never change,
-- and it is never removed.
CREATE FUNCTION "app"."keep_possession"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' OR OLD.ended_at IS NOT NULL THEN
      RAISE EXCEPTION 'A possession is kept as it is once it has ended.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint
CREATE TRIGGER "possessions_kept"
  BEFORE UPDATE OR DELETE ON "possessions"
  FOR EACH ROW EXECUTE FUNCTION "app"."keep_possession"();--> statement-breakpoint

-- Each business's own, and the Operator app's only: the admin logins get nothing.
ALTER TABLE "inspections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "inspections" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("status", "odometer_km", "fuel_level", "keys_count", "accessories", "notes",
  "bond_override_reason", "acceptance_text", "completed_at", "cancelled_at", "updated_at")
  ON "inspections" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "inspections_web_tenant" ON "inspections" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint

ALTER TABLE "inspection_damage_marks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inspection_damage_marks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "inspection_damage_marks" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("description", "removed_at", "updated_at") ON "inspection_damage_marks" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "inspection_damage_marks_web_tenant" ON "inspection_damage_marks" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint

ALTER TABLE "possessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "possessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "possessions" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("ended_at", "return_inspection_id", "updated_at") ON "possessions" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "possessions_web_tenant" ON "possessions" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());
