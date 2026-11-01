CREATE TYPE "public"."rental_status" AS ENUM('draft', 'booked', 'active', 'returned', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."rental_type" AS ENUM('fixed_term', 'ongoing');--> statement-breakpoint
CREATE TABLE "car_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"rental_id" uuid NOT NULL,
	"held_during" "tstzrange" NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rental_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"rental_id" uuid NOT NULL,
	"weekly_rate_cents" integer NOT NULL,
	"applies_from" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rental_rates_rental_date_unique" UNIQUE("operator_id","rental_id","applies_from"),
	CONSTRAINT "rental_rates_amount" CHECK ("rental_rates"."weekly_rate_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "rentals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"renter_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"type" "rental_type" NOT NULL,
	"status" "rental_status" DEFAULT 'draft' NOT NULL,
	"planned_start" timestamp with time zone NOT NULL,
	"planned_end" timestamp with time zone,
	"handed_over_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"charge_weekday" smallint NOT NULL,
	"bond_cents" integer NOT NULL,
	"settings_snapshot" jsonb NOT NULL,
	"settings_version" integer NOT NULL,
	"notes" text,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rentals_id_operator_unique" UNIQUE("id","operator_id"),
	CONSTRAINT "rentals_period" CHECK (("rentals"."type" = 'ongoing') = ("rentals"."planned_end" is null)
        and ("rentals"."planned_end" is null or "rentals"."planned_end" > "rentals"."planned_start")),
	CONSTRAINT "rentals_charge_weekday" CHECK ("rentals"."charge_weekday" between 1 and 7),
	CONSTRAINT "rentals_bond" CHECK ("rentals"."bond_cents" >= 0),
	CONSTRAINT "rentals_cancelled" CHECK (("rentals"."status" = 'cancelled') = ("rentals"."cancelled_at" is not null)
        and ("rentals"."cancelled_at" is null) = ("rentals"."cancellation_reason" is null)),
	CONSTRAINT "rentals_handed_over" CHECK (("rentals"."status" in ('active', 'returned', 'closed')) = ("rentals"."handed_over_at" is not null)),
	CONSTRAINT "rentals_returned" CHECK (("rentals"."status" in ('returned', 'closed')) = ("rentals"."returned_at" is not null)
        and ("rentals"."returned_at" is null or "rentals"."returned_at" >= "rentals"."handed_over_at"))
);
--> statement-breakpoint
ALTER TABLE "car_holds" ADD CONSTRAINT "car_holds_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "car_holds" ADD CONSTRAINT "car_holds_vehicle_fk" FOREIGN KEY ("vehicle_id","operator_id") REFERENCES "public"."vehicles"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "car_holds" ADD CONSTRAINT "car_holds_rental_fk" FOREIGN KEY ("rental_id","operator_id") REFERENCES "public"."rentals"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_rates" ADD CONSTRAINT "rental_rates_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_rates" ADD CONSTRAINT "rental_rates_rental_fk" FOREIGN KEY ("rental_id","operator_id") REFERENCES "public"."rentals"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_renter_fk" FOREIGN KEY ("renter_id","operator_id") REFERENCES "public"."renters"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_vehicle_fk" FOREIGN KEY ("vehicle_id","operator_id") REFERENCES "public"."vehicles"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "car_holds_rental_idx" ON "car_holds" USING btree ("operator_id","rental_id");--> statement-breakpoint
CREATE INDEX "rentals_renter_idx" ON "rentals" USING btree ("operator_id","renter_id");--> statement-breakpoint
CREATE INDEX "rentals_vehicle_idx" ON "rentals" USING btree ("operator_id","vehicle_id");--> statement-breakpoint
CREATE INDEX "rentals_status_start_idx" ON "rentals" USING btree ("operator_id","status","planned_start");--> statement-breakpoint

-- Two holds on one car may never overlap (rule 18). btree_gist lets the
-- exclusion rule compare the car's id with "=" alongside the time ranges.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "car_holds" ADD CONSTRAINT "car_holds_no_overlap"
  EXCLUDE USING gist ("operator_id" WITH =, "vehicle_id" WITH =, "held_during" WITH &&)
  WHERE ("released_at" IS NULL);--> statement-breakpoint
ALTER TABLE "car_holds" ADD CONSTRAINT "car_holds_range"
  CHECK (NOT isempty("held_during") AND lower_inc("held_during") AND NOT upper_inc("held_during")
    AND lower("held_during") IS NOT NULL);--> statement-breakpoint

-- A rental only ever moves along its steps (docs/design/04): the same moves
-- as RENTAL_STATUS_MOVES in packages/core, checked again here so no code
-- path can skip one.
CREATE FUNCTION "app"."check_rental_status_move"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.status NOT IN ('draft', 'booked') THEN
        RAISE EXCEPTION 'A rental starts as a draft or a booking, not %.', NEW.status
          USING ERRCODE = 'check_violation';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.status = OLD.status THEN
      RETURN NEW;
    END IF;
    IF (OLD.status, NEW.status) NOT IN (
      ('draft', 'booked'), ('draft', 'cancelled'), ('booked', 'active'),
      ('booked', 'cancelled'), ('active', 'returned'), ('returned', 'closed')
    ) THEN
      RAISE EXCEPTION 'A rental cannot move from % to %.', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint
CREATE TRIGGER "rentals_status_moves"
  BEFORE INSERT OR UPDATE OF "status" ON "rentals"
  FOR EACH ROW EXECUTE FUNCTION "app"."check_rental_status_move"();--> statement-breakpoint

-- The settings copied onto a rental never change (rule 14).
CREATE FUNCTION "app"."keep_rental_settings"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF NEW.settings_snapshot IS DISTINCT FROM OLD.settings_snapshot
      OR NEW.settings_version IS DISTINCT FROM OLD.settings_version THEN
      RAISE EXCEPTION 'A rental keeps the settings it was made with.'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint
CREATE TRIGGER "rentals_settings_kept"
  BEFORE UPDATE ON "rentals"
  FOR EACH ROW EXECUTE FUNCTION "app"."keep_rental_settings"();--> statement-breakpoint

-- Rates are a history: added to, never changed or removed.
CREATE TRIGGER "rental_rates_append_only"
  BEFORE UPDATE OR DELETE ON "rental_rates"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "rental_rates_no_truncate"
  BEFORE TRUNCATE ON "rental_rates"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint

-- Each business's own, and the Operator app's only: the admin login has no
-- grant on any of these (Admins cannot see Renters' rentals in v1).
ALTER TABLE "rentals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rentals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "rentals" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("vehicle_id", "type", "status", "planned_start", "planned_end", "handed_over_at",
  "returned_at", "charge_weekday", "bond_cents", "notes", "cancelled_at", "cancellation_reason",
  "updated_at") ON "rentals" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "rentals_web_tenant" ON "rentals" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint

ALTER TABLE "rental_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rental_rates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "rental_rates" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "rental_rates_web_tenant" ON "rental_rates" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint

ALTER TABLE "car_holds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "car_holds" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "car_holds" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("held_during", "released_at", "updated_at") ON "car_holds" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "car_holds_web_tenant" ON "car_holds" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());
