CREATE TYPE "public"."purchase_source" AS ENUM('dealer', 'private');--> statement-breakpoint
CREATE TYPE "public"."vehicle_cost_kind" AS ENUM('refurb', 'repair', 'other');--> statement-breakpoint
CREATE TABLE "vehicle_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"incurred_on" date NOT NULL,
	"kind" "vehicle_cost_kind" NOT NULL,
	"description" text NOT NULL,
	"cost_cents" integer NOT NULL,
	"gst_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "vehicle_costs_cost_not_negative" CHECK ("cost_cents" >= 0),
	CONSTRAINT "vehicle_costs_gst_within_cost" CHECK ("gst_cents" >= 0 and "gst_cents" <= round("cost_cents" / 11.0))
);
--> statement-breakpoint
CREATE TABLE "vehicle_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"purchased_on" date NOT NULL,
	"source" "purchase_source" NOT NULL,
	"seller_name" text NOT NULL,
	"seller_phone" text,
	"seller_address" text,
	"price_cents" integer NOT NULL,
	"gst_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "vehicle_purchases_private_no_gst" CHECK ("vehicle_purchases"."source" <> 'private' or "vehicle_purchases"."gst_cents" = 0),
	CONSTRAINT "vehicle_purchases_cost_not_negative" CHECK ("price_cents" >= 0),
	CONSTRAINT "vehicle_purchases_gst_within_cost" CHECK ("gst_cents" >= 0 and "gst_cents" <= round("price_cents" / 11.0))
);
--> statement-breakpoint
CREATE TABLE "vehicle_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"sold_at" timestamp with time zone NOT NULL,
	"price_cents" integer NOT NULL,
	"gst_cents" integer DEFAULT 0 NOT NULL,
	"buyer_name" text NOT NULL,
	"buyer_phone" text NOT NULL,
	"buyer_address" text NOT NULL,
	"buyer_licence_number" text,
	"buyer_licence_state" "australian_state",
	"transfer_lodged_on" date,
	"transfer_reference" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "vehicle_sales_cost_not_negative" CHECK ("price_cents" >= 0),
	CONSTRAINT "vehicle_sales_gst_within_cost" CHECK ("gst_cents" >= 0 and "gst_cents" <= round("price_cents" / 11.0))
);
--> statement-breakpoint
ALTER TABLE "vehicle_costs" ADD CONSTRAINT "vehicle_costs_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_costs" ADD CONSTRAINT "vehicle_costs_vehicle_fk" FOREIGN KEY ("vehicle_id","operator_id") REFERENCES "public"."vehicles"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_purchases" ADD CONSTRAINT "vehicle_purchases_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_purchases" ADD CONSTRAINT "vehicle_purchases_vehicle_fk" FOREIGN KEY ("vehicle_id","operator_id") REFERENCES "public"."vehicles"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_sales" ADD CONSTRAINT "vehicle_sales_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_sales" ADD CONSTRAINT "vehicle_sales_vehicle_fk" FOREIGN KEY ("vehicle_id","operator_id") REFERENCES "public"."vehicles"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicle_costs_vehicle_idx" ON "vehicle_costs" USING btree ("operator_id","vehicle_id","incurred_on");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_purchases_one_per_car" ON "vehicle_purchases" USING btree ("operator_id","vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_sales_one_active_per_car" ON "vehicle_sales" USING btree ("operator_id","vehicle_id") WHERE "vehicle_sales"."cancelled_at" is null;--> statement-breakpoint
-- An Operator reads, adds and edits only its own purchases, sales and
-- costs: a wrong cost is archived and a sale that falls through is
-- cancelled, never deleted. The admin app has no access to any of it, as
-- buyers' and sellers' details are personal information.
ALTER TABLE "vehicle_purchases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vehicle_purchases" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "vehicle_purchases" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("purchased_on", "source", "seller_name", "seller_phone", "seller_address", "price_cents", "gst_cents", "updated_at") ON "vehicle_purchases" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "vehicle_purchases_web_tenant" ON "vehicle_purchases" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
ALTER TABLE "vehicle_sales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vehicle_sales" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "vehicle_sales" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("sold_at", "price_cents", "gst_cents", "buyer_name", "buyer_phone", "buyer_address", "buyer_licence_number", "buyer_licence_state", "transfer_lodged_on", "transfer_reference", "cancelled_at", "updated_at") ON "vehicle_sales" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "vehicle_sales_web_tenant" ON "vehicle_sales" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
ALTER TABLE "vehicle_costs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vehicle_costs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "vehicle_costs" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("incurred_on", "kind", "description", "cost_cents", "gst_cents", "updated_at", "archived_at") ON "vehicle_costs" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "vehicle_costs_web_tenant" ON "vehicle_costs" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());
