CREATE TABLE "user_known_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"device_hash" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_known_devices" ADD CONSTRAINT "user_known_devices_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_known_devices" ADD CONSTRAINT "user_known_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_known_devices_user_device_unique" ON "user_known_devices" USING btree ("user_id","device_hash");--> statement-breakpoint
-- Only the Operator login system reaches this table: it holds fingerprints of
-- the cookies that mark a browser as known. `web_app_role` gets nothing. No
-- DELETE: retention clean-up is a scheduled job, not something the app does.
ALTER TABLE "user_known_devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_known_devices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TRIGGER "user_known_devices_operator_id"
  BEFORE INSERT OR UPDATE OF "user_id", "operator_id" ON "user_known_devices"
  FOR EACH ROW EXECUTE FUNCTION "app"."set_operator_id_from_user"();--> statement-breakpoint
GRANT SELECT, INSERT ON "user_known_devices" TO "web_auth_role";--> statement-breakpoint
GRANT UPDATE ("last_seen_at") ON "user_known_devices" TO "web_auth_role";--> statement-breakpoint
CREATE POLICY "user_known_devices_auth_all" ON "user_known_devices" FOR ALL TO "web_auth_role"
  USING (true) WITH CHECK (true);
