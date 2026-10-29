CREATE TYPE "public"."insurance_cover_type" AS ENUM('comprehensive', 'third_party_fire_theft', 'third_party_property');--> statement-breakpoint
CREATE TABLE "insurance_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"insurer" text NOT NULL,
	"policy_number" text NOT NULL,
	"cover_type" "insurance_cover_type" NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"excess_cents" integer,
	"cost_cents" integer NOT NULL,
	"gst_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "insurance_policies_id_operator_unique" UNIQUE("id","operator_id"),
	CONSTRAINT "insurance_policies_dates" CHECK ("insurance_policies"."ends_on" > "insurance_policies"."starts_on"),
	CONSTRAINT "insurance_policies_excess_not_negative" CHECK ("insurance_policies"."excess_cents" >= 0),
	CONSTRAINT "insurance_policies_cost_not_negative" CHECK ("cost_cents" >= 0),
	CONSTRAINT "insurance_policies_gst_within_cost" CHECK ("gst_cents" >= 0 and "gst_cents" <= round("cost_cents" / 11.0))
);
--> statement-breakpoint
CREATE TABLE "insurance_policy_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vehicle_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"state" "australian_state" NOT NULL,
	"term_months" integer NOT NULL,
	"expires_on" date NOT NULL,
	"paid_on" date,
	"cost_cents" integer NOT NULL,
	"gst_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "vehicle_registrations_term" CHECK ("vehicle_registrations"."term_months" in (3, 6, 12)),
	CONSTRAINT "vehicle_registrations_cost_not_negative" CHECK ("cost_cents" >= 0),
	CONSTRAINT "vehicle_registrations_gst_within_cost" CHECK ("gst_cents" >= 0 and "gst_cents" <= round("cost_cents" / 11.0))
);
--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_policy_vehicles" ADD CONSTRAINT "insurance_policy_vehicles_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_policy_vehicles" ADD CONSTRAINT "insurance_policy_vehicles_policy_fk" FOREIGN KEY ("policy_id","operator_id") REFERENCES "public"."insurance_policies"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_policy_vehicles" ADD CONSTRAINT "insurance_policy_vehicles_vehicle_fk" FOREIGN KEY ("vehicle_id","operator_id") REFERENCES "public"."vehicles"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_registrations" ADD CONSTRAINT "vehicle_registrations_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_registrations" ADD CONSTRAINT "vehicle_registrations_vehicle_fk" FOREIGN KEY ("vehicle_id","operator_id") REFERENCES "public"."vehicles"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "insurance_policies_operator_idx" ON "insurance_policies" USING btree ("operator_id","ends_on");--> statement-breakpoint
CREATE UNIQUE INDEX "insurance_policy_vehicles_one_active" ON "insurance_policy_vehicles" USING btree ("policy_id","vehicle_id") WHERE "insurance_policy_vehicles"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "insurance_policy_vehicles_vehicle_idx" ON "insurance_policy_vehicles" USING btree ("operator_id","vehicle_id");--> statement-breakpoint
CREATE INDEX "vehicle_registrations_vehicle_idx" ON "vehicle_registrations" USING btree ("operator_id","vehicle_id","expires_on");--> statement-breakpoint
-- An Operator reads, adds and edits only its own rego renewals and
-- policies, and archives rather than deletes them. The admin app has no
-- access to any of it.
ALTER TABLE "vehicle_registrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vehicle_registrations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "vehicle_registrations" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("state", "term_months", "expires_on", "paid_on", "cost_cents", "gst_cents", "updated_at", "archived_at") ON "vehicle_registrations" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "vehicle_registrations_web_tenant" ON "vehicle_registrations" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
ALTER TABLE "insurance_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "insurance_policies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "insurance_policies" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("insurer", "policy_number", "cover_type", "starts_on", "ends_on", "excess_cents", "cost_cents", "gst_cents", "updated_at", "archived_at") ON "insurance_policies" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "insurance_policies_web_tenant" ON "insurance_policies" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
-- A car is put on a policy (a new row) or taken off (the row is closed).
ALTER TABLE "insurance_policy_vehicles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "insurance_policy_vehicles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "insurance_policy_vehicles" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("removed_at") ON "insurance_policy_vehicles" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "insurance_policy_vehicles_web_tenant" ON "insurance_policy_vehicles" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());
