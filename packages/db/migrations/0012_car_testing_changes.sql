CREATE TYPE "public"."insurance_payment_frequency" AS ENUM('yearly', 'monthly', 'fortnightly');--> statement-breakpoint
ALTER TABLE "vehicle_registrations" DROP CONSTRAINT "vehicle_registrations_term";--> statement-breakpoint
ALTER TABLE "vehicle_costs" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."vehicle_cost_kind";--> statement-breakpoint
CREATE TYPE "public"."vehicle_cost_kind" AS ENUM('servicing', 'repair', 'refurb', 'other');--> statement-breakpoint
ALTER TABLE "vehicle_costs" ALTER COLUMN "kind" SET DATA TYPE "public"."vehicle_cost_kind" USING "kind"::"public"."vehicle_cost_kind";--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "payment_frequency" "insurance_payment_frequency" DEFAULT 'yearly' NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicle_registrations" ADD CONSTRAINT "vehicle_registrations_term" CHECK ("vehicle_registrations"."term_months" in (1, 3, 6, 9, 12));--> statement-breakpoint
-- The Operator app may change how a policy is paid, like its other details.
GRANT UPDATE ("payment_frequency") ON "insurance_policies" TO "web_app_role";
