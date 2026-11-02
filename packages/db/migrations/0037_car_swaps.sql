CREATE TYPE "public"."car_swap_status" AS ENUM('in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "car_swaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"rental_id" uuid NOT NULL,
	"from_vehicle_id" uuid NOT NULL,
	"to_vehicle_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" "car_swap_status" DEFAULT 'in_progress' NOT NULL,
	"return_inspection_id" uuid NOT NULL,
	"handover_inspection_id" uuid NOT NULL,
	"from_vehicle_status_after" "vehicle_status",
	"swapped_at" timestamp with time zone,
	"document_id" uuid,
	"started_by_user_id" uuid NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "car_swaps_id_operator_unique" UNIQUE("id","operator_id"),
	CONSTRAINT "car_swaps_other_car" CHECK ("car_swaps"."from_vehicle_id" <> "car_swaps"."to_vehicle_id"),
	CONSTRAINT "car_swaps_reason" CHECK (length(trim("car_swaps"."reason")) > 0),
	CONSTRAINT "car_swaps_completed" CHECK (("car_swaps"."status" = 'completed') = ("car_swaps"."swapped_at" is not null)
        and ("car_swaps"."status" <> 'completed' or ("car_swaps"."document_id" is not null
          and "car_swaps"."from_vehicle_status_after" in ('available', 'in_service', 'off_road')))),
	CONSTRAINT "car_swaps_cancelled" CHECK (("car_swaps"."status" = 'cancelled') = ("car_swaps"."cancelled_at" is not null))
);
--> statement-breakpoint
DROP INDEX "inspections_one_completed";--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "is_for_swap" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "car_swaps" ADD CONSTRAINT "car_swaps_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "car_swaps" ADD CONSTRAINT "car_swaps_started_by_user_id_users_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "car_swaps" ADD CONSTRAINT "car_swaps_rental_fk" FOREIGN KEY ("rental_id","operator_id") REFERENCES "public"."rentals"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "car_swaps" ADD CONSTRAINT "car_swaps_from_vehicle_fk" FOREIGN KEY ("from_vehicle_id","operator_id") REFERENCES "public"."vehicles"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "car_swaps" ADD CONSTRAINT "car_swaps_to_vehicle_fk" FOREIGN KEY ("to_vehicle_id","operator_id") REFERENCES "public"."vehicles"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "car_swaps" ADD CONSTRAINT "car_swaps_return_inspection_fk" FOREIGN KEY ("return_inspection_id","operator_id") REFERENCES "public"."inspections"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "car_swaps" ADD CONSTRAINT "car_swaps_handover_inspection_fk" FOREIGN KEY ("handover_inspection_id","operator_id") REFERENCES "public"."inspections"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "car_swaps" ADD CONSTRAINT "car_swaps_document_fk" FOREIGN KEY ("document_id","operator_id") REFERENCES "public"."issued_documents"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "car_swaps_rental_idx" ON "car_swaps" USING btree ("operator_id","rental_id");--> statement-breakpoint
CREATE UNIQUE INDEX "car_swaps_one_in_progress" ON "car_swaps" USING btree ("operator_id","rental_id") WHERE "car_swaps"."status" = 'in_progress';--> statement-breakpoint
CREATE UNIQUE INDEX "inspections_one_completed" ON "inspections" USING btree ("operator_id","rental_id","kind") WHERE "inspections"."status" = 'completed' and not "inspections"."is_for_swap";--> statement-breakpoint
-- A finished or cancelled swap is history: nothing on it changes again.
CREATE FUNCTION "app"."keep_finished_car_swap"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF OLD.status <> 'in_progress' THEN
      RAISE EXCEPTION 'A % car swap cannot change.', OLD.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint
CREATE TRIGGER "car_swaps_finished_kept"
  BEFORE UPDATE ON "car_swaps"
  FOR EACH ROW EXECUTE FUNCTION "app"."keep_finished_car_swap"();--> statement-breakpoint
CREATE TRIGGER "car_swaps_no_delete"
  BEFORE DELETE ON "car_swaps"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "car_swaps_no_truncate"
  BEFORE TRUNCATE ON "car_swaps"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint

-- Once the car is out, the rental's car changes only to the car of its swap
-- under way (rule 15: possession follows the swap), never by itself.
CREATE FUNCTION "app"."check_rental_car_change"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
  BEGIN
    IF NEW.vehicle_id IS NOT DISTINCT FROM OLD.vehicle_id OR OLD.status IN ('draft', 'booked') THEN
      RETURN NEW;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM "public"."car_swaps" s
      WHERE s.rental_id = NEW.id AND s.operator_id = NEW.operator_id
        AND s.status = 'in_progress' AND s.to_vehicle_id = NEW.vehicle_id
    ) THEN
      RAISE EXCEPTION 'A rental''s car changes only through a car swap once it is out.'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END;
  $$;--> statement-breakpoint
CREATE TRIGGER "rentals_car_changes"
  BEFORE UPDATE OF "vehicle_id" ON "rentals"
  FOR EACH ROW EXECUTE FUNCTION "app"."check_rental_car_change"();--> statement-breakpoint

-- Each business's own, and the Operator app's only: the admin logins get nothing (rule 5).
ALTER TABLE "car_swaps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "car_swaps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "car_swaps" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("status", "from_vehicle_status_after", "swapped_at", "document_id", "cancelled_at",
  "updated_at") ON "car_swaps" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "car_swaps_web_tenant" ON "car_swaps" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());
