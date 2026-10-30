ALTER TABLE "vehicle_registrations" ALTER COLUMN "expires_on" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicle_registrations" ADD COLUMN "direct_debit_stopped_on" date;--> statement-breakpoint
-- Monthly renewals saved before this change carry an expiry date; a direct
-- debit has none. Forced row-level security hides every row from the owner,
-- so it is lifted for this one update, inside this migration's transaction.
ALTER TABLE "vehicle_registrations" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE "vehicle_registrations" SET "expires_on" = NULL WHERE "term_months" = 1;--> statement-breakpoint
ALTER TABLE "vehicle_registrations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vehicle_registrations" ADD CONSTRAINT "vehicle_registrations_direct_debit" CHECK (("vehicle_registrations"."term_months" = 1) = ("vehicle_registrations"."expires_on" is null)
        and ("vehicle_registrations"."direct_debit_stopped_on" is null or "vehicle_registrations"."term_months" = 1));--> statement-breakpoint
-- The Operator app stops a direct debit by giving the date it stopped.
GRANT UPDATE ("direct_debit_stopped_on") ON "vehicle_registrations" TO "web_app_role";
