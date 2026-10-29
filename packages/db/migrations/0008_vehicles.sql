CREATE TYPE "public"."body_type" AS ENUM('sedan', 'hatch', 'wagon', 'suv', 'ute', 'van', 'people_mover', 'coupe', 'convertible');--> statement-breakpoint
CREATE TYPE "public"."fuel_type" AS ENUM('petrol', 'diesel', 'hybrid', 'plug_in_hybrid', 'electric', 'lpg');--> statement-breakpoint
CREATE TYPE "public"."odometer_source" AS ENUM('purchase', 'handover', 'return', 'service', 'renter', 'manual');--> statement-breakpoint
CREATE TYPE "public"."transmission" AS ENUM('automatic', 'manual');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('available', 'in_service', 'off_road', 'sold', 'written_off');--> statement-breakpoint
CREATE TABLE "odometer_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"kilometres" integer NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"source" "odometer_source" NOT NULL,
	"is_verified" boolean DEFAULT true NOT NULL,
	"recorded_by_user_id" uuid,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "odometer_readings_kilometres_range" CHECK ("odometer_readings"."kilometres" between 0 and 2000000)
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"rego" text NOT NULL,
	"rego_state" "australian_state" NOT NULL,
	"vin" text,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"variant" text,
	"year" integer NOT NULL,
	"colour" text,
	"body_type" "body_type",
	"transmission" "transmission",
	"fuel_type" "fuel_type",
	"seats" integer,
	"status" "vehicle_status" DEFAULT 'available' NOT NULL,
	"status_reason" text,
	"status_expected_back" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "vehicles_id_operator_unique" UNIQUE("id","operator_id"),
	CONSTRAINT "vehicles_status_return_details" CHECK (("vehicles"."status" in ('in_service', 'off_road')) = ("vehicles"."status_reason" is not null and "vehicles"."status_expected_back" is not null)
        and ("vehicles"."status_reason" is null) = ("vehicles"."status_expected_back" is null)),
	CONSTRAINT "vehicles_year_range" CHECK ("vehicles"."year" between 1950 and 2100),
	CONSTRAINT "vehicles_seats_range" CHECK ("vehicles"."seats" between 1 and 15)
);
--> statement-breakpoint
ALTER TABLE "odometer_readings" ADD CONSTRAINT "odometer_readings_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odometer_readings" ADD CONSTRAINT "odometer_readings_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odometer_readings" ADD CONSTRAINT "odometer_readings_vehicle_fk" FOREIGN KEY ("vehicle_id","operator_id") REFERENCES "public"."vehicles"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "odometer_readings_vehicle_idx" ON "odometer_readings" USING btree ("operator_id","vehicle_id","recorded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_one_rego_per_operator" ON "vehicles" USING btree ("operator_id","rego_state","rego") WHERE "vehicles"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_one_vin_per_operator" ON "vehicles" USING btree ("operator_id","vin") WHERE "vehicles"."vin" is not null and "vehicles"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "vehicles_operator_idx" ON "vehicles" USING btree ("operator_id","rego");--> statement-breakpoint
-- An Operator reads, adds and edits only its own cars. Never which Operator a
-- car belongs to, its ID or when it was added. Nobody deletes a car: it is
-- archived (rule 13). The admin app has no access to cars at all.
ALTER TABLE "vehicles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vehicles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "vehicles" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("rego", "rego_state", "vin", "make", "model", "variant", "year", "colour", "body_type", "transmission", "fuel_type", "seats", "status", "status_reason", "status_expected_back", "updated_at", "archived_at") ON "vehicles" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "vehicles_web_tenant" ON "vehicles" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
-- Readings are what was seen: added, and withdrawn if entered by mistake,
-- never changed or deleted.
ALTER TABLE "odometer_readings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "odometer_readings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "odometer_readings" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("withdrawn_at") ON "odometer_readings" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "odometer_readings_web_tenant" ON "odometer_readings" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());
