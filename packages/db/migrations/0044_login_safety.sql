CREATE TABLE "password_reset_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_two_factors" ADD COLUMN "last_code_hash" text;--> statement-breakpoint
ALTER TABLE "admin_two_factors" ADD COLUMN "last_code_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_two_factors" ADD COLUMN "last_code_hash" text;--> statement-breakpoint
ALTER TABLE "user_two_factors" ADD COLUMN "last_code_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "password_reset_sends" ADD CONSTRAINT "password_reset_sends_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_sends" ADD CONSTRAINT "password_reset_sends_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "password_reset_sends_user_idx" ON "password_reset_sends" USING btree ("user_id","sent_at");--> statement-breakpoint

-- Each password reset email sent (review G6-1): the login system's own, like
-- the other user_* tables, its Operator filled in from the User.
CREATE TRIGGER "password_reset_sends_operator_id"
  BEFORE INSERT OR UPDATE OF "user_id", "operator_id" ON "password_reset_sends"
  FOR EACH ROW EXECUTE FUNCTION "app"."set_operator_id_from_user"();--> statement-breakpoint
ALTER TABLE "password_reset_sends" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "password_reset_sends" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "password_reset_sends" TO "web_auth_role";--> statement-breakpoint
CREATE POLICY "password_reset_sends_auth_all" ON "password_reset_sends" FOR ALL TO "web_auth_role"
  USING (true) WITH CHECK (true);--> statement-breakpoint

-- A paused (suspended) business's Renters can still pay their bond and set up
-- their direct debit: that money goes to the business's own Stripe, and
-- stopping it hurts only the Renter (Abhi, 5 Nov 2026). Every other link stops.
CREATE OR REPLACE FUNCTION "app"."renter_link_for_token"("token_hash" text)
RETURNS TABLE ("operator_id" uuid, "link_id" uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT "l"."operator_id", "l"."id" FROM "public"."renter_links" "l"
  JOIN "public"."operators" "o" ON "o"."id" = "l"."operator_id"
  WHERE "l"."token_hash" = "renter_link_for_token"."token_hash"
    AND "l"."cancelled_at" IS NULL
    AND "l"."expires_at" > now()
    AND ("o"."suspended_at" IS NULL OR "l"."purpose" = 'set_up_payments')
    AND "o"."archived_at" IS NULL
$$;--> statement-breakpoint

-- The admin app's database login can do only what its screens do (review
-- A9-3, A1-4). Businesses: made with a name, then paused or reactivated;
-- never their GST status, timezone or Stripe columns.
REVOKE UPDATE ON "operators" FROM "admin_app_role";--> statement-breakpoint
GRANT UPDATE ("suspended_at", "updated_at") ON "operators" TO "admin_app_role";--> statement-breakpoint
-- A new business from the admin app carries its name only: every other
-- column keeps its default. (Insert stays table-wide, as Drizzle names every
-- column when it inserts; this check does the narrowing.)
CREATE FUNCTION "app"."check_admin_operator_insert"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF current_user = 'admin_app_role' AND (
    NEW.abn IS NOT NULL OR NEW.gst_registered OR NEW.gst_registered_from IS NOT NULL
    OR NEW.address_line1 IS NOT NULL OR NEW.address_line2 IS NOT NULL OR NEW.suburb IS NOT NULL
    OR NEW.state IS NOT NULL OR NEW.postcode IS NOT NULL OR NEW.phone IS NOT NULL
    OR NEW.email IS NOT NULL OR NEW.logo_file_key IS NOT NULL
    -- The column's own default (DEFAULT_TIMEZONE in packages/core).
    OR NEW.timezone <> 'Australia/Perth'
    OR NEW.stripe_account_id IS NOT NULL OR NEW.stripe_charges_enabled
    OR NEW.stripe_payouts_enabled OR NEW.stripe_becs_capability_status IS NOT NULL
    OR NEW.subscription_status <> 'trial' OR NEW.suspended_at IS NOT NULL
    OR NEW.archived_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'The admin app may give a new business its name only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "operators_admin_insert_checked"
  BEFORE INSERT ON "operators"
  FOR EACH ROW EXECUTE FUNCTION "app"."check_admin_operator_insert"();--> statement-breakpoint
-- AGS staff logins are made only by the first-admin command, on the login's
-- own connection: the app's connection can't make one.
REVOKE INSERT ON "admin_users" FROM "admin_app_role";--> statement-breakpoint
-- No admin screen reads a business's settings, which hold the bank details
-- each business types into "How to pay" (rule 5).
DROP POLICY "operator_settings_admin_read" ON "operator_settings";--> statement-breakpoint
REVOKE SELECT ON "operator_settings" FROM "admin_app_role";
