CREATE TABLE "operator_settings" (
	"operator_id" uuid PRIMARY KEY NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operator_settings" ADD CONSTRAINT "operator_settings_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- An Operator reads and changes only its own settings. The admin app may
-- read them, to help an Operator, but not change them. Nobody deletes a row:
-- an Operator's settings are a record of how it chose to run.
ALTER TABLE "operator_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "operator_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "operator_settings" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("settings", "version", "updated_at") ON "operator_settings" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "operator_settings_web_tenant" ON "operator_settings" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
GRANT SELECT ON "operator_settings" TO "admin_app_role";--> statement-breakpoint
CREATE POLICY "operator_settings_admin_read" ON "operator_settings" FOR SELECT TO "admin_app_role"
  USING (true);
