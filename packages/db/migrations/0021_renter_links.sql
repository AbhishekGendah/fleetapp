CREATE TYPE "public"."renter_link_purpose" AS ENUM('details_form');--> statement-breakpoint
CREATE TABLE "renter_link_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"device_token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "renter_link_devices_device_token_hash_unique" UNIQUE("device_token_hash")
);
--> statement-breakpoint
CREATE TABLE "renter_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"renter_id" uuid NOT NULL,
	"purpose" "renter_link_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"sent_to_email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"code_hash" text,
	"code_expires_at" timestamp with time zone,
	"code_tries" integer DEFAULT 0 NOT NULL,
	"codes_window_started_at" timestamp with time zone,
	"codes_in_window" integer DEFAULT 0 NOT NULL,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "renter_links_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "renter_links_id_operator_unique" UNIQUE("id","operator_id"),
	CONSTRAINT "renter_links_code_whole" CHECK (("renter_links"."code_hash" is null) = ("renter_links"."code_expires_at" is null)),
	CONSTRAINT "renter_links_counts" CHECK ("renter_links"."code_tries" >= 0 and "renter_links"."codes_in_window" >= 0)
);
--> statement-breakpoint
ALTER TABLE "dev_email_outbox" ADD COLUMN "reply_to" text;--> statement-breakpoint
ALTER TABLE "renter_link_devices" ADD CONSTRAINT "renter_link_devices_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renter_link_devices" ADD CONSTRAINT "renter_link_devices_link_fk" FOREIGN KEY ("link_id","operator_id") REFERENCES "public"."renter_links"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renter_links" ADD CONSTRAINT "renter_links_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renter_links" ADD CONSTRAINT "renter_links_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renter_links" ADD CONSTRAINT "renter_links_renter_fk" FOREIGN KEY ("renter_id","operator_id") REFERENCES "public"."renters"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "renter_links_one_live_per_purpose" ON "renter_links" USING btree ("operator_id","renter_id","purpose") WHERE "renter_links"."cancelled_at" is null;--> statement-breakpoint
CREATE INDEX "renter_links_renter_idx" ON "renter_links" USING btree ("operator_id","renter_id");--> statement-breakpoint
-- An Operator reads and adds links for its own Renters only; a link is
-- cancelled, never deleted. The admin app is granted nothing (rule 5).
ALTER TABLE "renter_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "renter_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "renter_links" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("cancelled_at", "code_hash", "code_expires_at", "code_tries", "codes_window_started_at", "codes_in_window", "locked_at", "updated_at") ON "renter_links" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "renter_links_web_tenant" ON "renter_links" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
ALTER TABLE "renter_link_devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "renter_link_devices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "renter_link_devices" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "renter_link_devices_web_tenant" ON "renter_link_devices" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
-- A Renter opening a link has no session (rule 3). This function turns the
-- fingerprint of the secret in the address into its Operator and link, for
-- a live link only, and tells nothing else: everything after runs inside that
-- one Operator's data with its tenant context set. It runs as the migration
-- owner (SECURITY DEFINER), which gets a read policy for it; the owner owns the
-- table and could switch row-level security off anyway, so nothing new is
-- exposed. The Operator app's role may only call it.
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY "renter_links_owner_lookup" ON "renter_links" FOR SELECT TO %I USING (true)',
    current_user
  );
END
$$;--> statement-breakpoint
CREATE FUNCTION "app"."renter_link_for_token"("token_hash" text)
RETURNS TABLE ("operator_id" uuid, "link_id" uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT "l"."operator_id", "l"."id" FROM "public"."renter_links" "l"
  WHERE "l"."token_hash" = "renter_link_for_token"."token_hash"
    AND "l"."cancelled_at" IS NULL
    AND "l"."expires_at" > now()
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."renter_link_for_token"(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."renter_link_for_token"(text) TO "web_app_role";
