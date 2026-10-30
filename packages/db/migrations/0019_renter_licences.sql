CREATE TYPE "public"."licence_side" AS ENUM('front', 'back');--> statement-breakpoint
CREATE TYPE "public"."licence_class" AS ENUM('C', 'LR', 'MR', 'HR', 'HC', 'MC');--> statement-breakpoint
CREATE TYPE "public"."licence_issuer" AS ENUM('NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT', 'overseas');--> statement-breakpoint
CREATE TYPE "public"."licence_type" AS ENUM('full', 'provisional');--> statement-breakpoint
ALTER TYPE "public"."file_purpose" ADD VALUE 'renter_licence_scan';--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "renter_id" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "licence_side" "licence_side";--> statement-breakpoint
ALTER TABLE "renters" ADD COLUMN "licence_issued_in" "licence_issuer";--> statement-breakpoint
ALTER TABLE "renters" ADD COLUMN "licence_country" text;--> statement-breakpoint
ALTER TABLE "renters" ADD COLUMN "licence_number" text;--> statement-breakpoint
ALTER TABLE "renters" ADD COLUMN "licence_class" "licence_class";--> statement-breakpoint
ALTER TABLE "renters" ADD COLUMN "licence_type" "licence_type";--> statement-breakpoint
ALTER TABLE "renters" ADD COLUMN "licence_expires_on" date;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_renter_fk" FOREIGN KEY ("renter_id","operator_id") REFERENCES "public"."renters"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "files_one_licence_scan_per_side" ON "files" USING btree ("operator_id","renter_id","licence_side") WHERE "files"."renter_id" is not null and "files"."confirmed_at" is not null and "files"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "renters_one_licence_per_operator" ON "renters" USING btree ("operator_id","licence_issued_in",coalesce("licence_country", ''),"licence_number") WHERE "renters"."licence_number" is not null;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_licence_scan_links" CHECK (("files"."purpose"::text = 'renter_licence_scan') = ("files"."renter_id" is not null)
        and ("files"."renter_id" is null) = ("files"."licence_side" is null)
        and ("files"."purpose"::text <> 'renter_licence_scan' or "files"."vehicle_id" is null));--> statement-breakpoint
ALTER TABLE "renters" ADD CONSTRAINT "renters_licence_complete" CHECK (num_nonnulls("renters"."licence_issued_in", "renters"."licence_number", "renters"."licence_class", "renters"."licence_type", "renters"."licence_expires_on") in (0, 5)
        and ("renters"."licence_country" is not null) = coalesce("renters"."licence_issued_in"::text = 'overseas', false)
        and "renters"."licence_number" ~ '^[A-Z0-9]{1,20}$');--> statement-breakpoint
-- The Operator app edits the licence along with the rest of the Renter. The
-- admin app is still granted nothing on renters, and cannot see which Renter
-- a file belongs to (its files grant lists other columns only).
GRANT UPDATE ("licence_issued_in", "licence_country", "licence_number", "licence_class", "licence_type", "licence_expires_on") ON "renters" TO "web_app_role";
