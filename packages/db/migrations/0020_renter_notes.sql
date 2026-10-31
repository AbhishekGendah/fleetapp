CREATE TABLE "renter_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"renter_id" uuid NOT NULL,
	"body" text NOT NULL,
	"written_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "renter_notes_body_not_blank" CHECK (length(trim("renter_notes"."body")) > 0)
);
--> statement-breakpoint
ALTER TABLE "renter_notes" ADD CONSTRAINT "renter_notes_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renter_notes" ADD CONSTRAINT "renter_notes_written_by_user_id_users_id_fk" FOREIGN KEY ("written_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renter_notes" ADD CONSTRAINT "renter_notes_renter_fk" FOREIGN KEY ("renter_id","operator_id") REFERENCES "public"."renters"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "renter_notes_renter_idx" ON "renter_notes" USING btree ("operator_id","renter_id","created_at");--> statement-breakpoint
-- An Operator reads and adds notes about its own Renters only; a note is
-- never edited, only archived. The admin app is granted nothing (rule 5).
ALTER TABLE "renter_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "renter_notes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "renter_notes" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("archived_at", "updated_at") ON "renter_notes" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "renter_notes_web_tenant" ON "renter_notes" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());
