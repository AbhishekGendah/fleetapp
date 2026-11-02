ALTER TABLE "inspections" ADD COLUMN "is_renter_absent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_renter_absent_on_return" CHECK ("inspections"."kind" = 'return' or not "inspections"."is_renter_absent");--> statement-breakpoint
-- Set once, when the return is completed; the finished checklist is then kept as it is.
GRANT UPDATE ("is_renter_absent") ON "inspections" TO "web_app_role";
