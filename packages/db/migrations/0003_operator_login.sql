CREATE TABLE "user_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"password" text,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"failed_sign_in_count" integer DEFAULT 0 NOT NULL,
	"sign_in_locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_two_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean,
	"failed_verification_count" integer,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_accounts" ADD COLUMN "failed_sign_in_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_accounts" ADD COLUMN "sign_in_locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_two_factors" ADD CONSTRAINT "user_two_factors_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_two_factors" ADD CONSTRAINT "user_two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_accounts_user_id_idx" ON "user_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_accounts_user_provider_unique" ON "user_accounts" USING btree ("user_id","provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_sessions_token_unique" ON "user_sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_two_factors_user_id_idx" ON "user_two_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_verifications_identifier_idx" ON "user_verifications" USING btree ("identifier");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Operator login security.
--
-- `web_auth_role` is used only by the Operator login system. It reaches the
-- User credential tables below; `web_app_role`, which runs the rest of the
-- Operator app, is granted nothing on them. It reads across Operators, because
-- signing in happens before anyone knows which Operator the person belongs to.
--
-- The role must already exist. Roles are cluster-level objects that Neon
-- manages, so creating one here would work locally and fail where it matters.
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA "public" TO "web_auth_role";--> statement-breakpoint
GRANT USAGE ON SCHEMA "app" TO "web_auth_role";--> statement-breakpoint

-- Better Auth knows nothing of Operators, so it never sets `operator_id`. This
-- copies it from the User on every insert, and again if `user_id` changes, so
-- a login row can never claim a different Operator from its User. Runs as the
-- caller: only a role that can already read the User can use it.
CREATE FUNCTION "app"."set_operator_id_from_user"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  SELECT "operator_id" INTO NEW."operator_id" FROM "public"."users" WHERE "id" = NEW."user_id";
  IF NEW."operator_id" IS NULL THEN
    RAISE EXCEPTION 'No User % to take the Operator from', NEW."user_id"
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "user_accounts_operator_id"
  BEFORE INSERT OR UPDATE OF "user_id", "operator_id" ON "user_accounts"
  FOR EACH ROW EXECUTE FUNCTION "app"."set_operator_id_from_user"();--> statement-breakpoint
CREATE TRIGGER "user_sessions_operator_id"
  BEFORE INSERT OR UPDATE OF "user_id", "operator_id" ON "user_sessions"
  FOR EACH ROW EXECUTE FUNCTION "app"."set_operator_id_from_user"();--> statement-breakpoint
CREATE TRIGGER "user_two_factors_operator_id"
  BEFORE INSERT OR UPDATE OF "user_id", "operator_id" ON "user_two_factors"
  FOR EACH ROW EXECUTE FUNCTION "app"."set_operator_id_from_user"();--> statement-breakpoint

-- Migration 0000 granted both app roles table-level UPDATE on `users`, which
-- now covers `email_verified` and `two_factor_enabled`. Those decide whether
-- someone must present an authenticator code, so neither the Operator app nor
-- the ordinary admin app may write them. Narrowed to column-level grants.
REVOKE UPDATE ON "users" FROM "web_app_role";--> statement-breakpoint
GRANT UPDATE ("full_name", "updated_at") ON "users" TO "web_app_role";--> statement-breakpoint
REVOKE UPDATE ON "users" FROM "admin_app_role";--> statement-breakpoint
GRANT UPDATE ("email", "full_name", "archived_at", "updated_at") ON "users" TO "admin_app_role";--> statement-breakpoint

-- Reading a User by email before anyone is signed in, and setting the two
-- flags the login system owns. No INSERT: Users are created by Admins.
GRANT SELECT ON "users" TO "web_auth_role";--> statement-breakpoint
GRANT UPDATE ("email_verified", "two_factor_enabled", "image", "updated_at") ON "users" TO "web_auth_role";--> statement-breakpoint
CREATE POLICY "users_auth_all" ON "users" FOR ALL TO "web_auth_role"
  USING (true) WITH CHECK (true);--> statement-breakpoint

-- The credential tables. DELETE on sessions, reset tokens and authenticator
-- enrolments, because signing out, using a reset link and turning off
-- two-factor are deletions. None on `user_accounts`: that row IS the password.
ALTER TABLE "user_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "user_accounts" TO "web_auth_role";--> statement-breakpoint
CREATE POLICY "user_accounts_auth_all" ON "user_accounts" FOR ALL TO "web_auth_role"
  USING (true) WITH CHECK (true);--> statement-breakpoint

ALTER TABLE "user_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "user_sessions" TO "web_auth_role";--> statement-breakpoint
CREATE POLICY "user_sessions_auth_all" ON "user_sessions" FOR ALL TO "web_auth_role"
  USING (true) WITH CHECK (true);--> statement-breakpoint

ALTER TABLE "user_verifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_verifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "user_verifications" TO "web_auth_role";--> statement-breakpoint
CREATE POLICY "user_verifications_auth_all" ON "user_verifications" FOR ALL TO "web_auth_role"
  USING (true) WITH CHECK (true);--> statement-breakpoint

ALTER TABLE "user_two_factors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_two_factors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "user_two_factors" TO "web_auth_role";--> statement-breakpoint
CREATE POLICY "user_two_factors_auth_all" ON "user_two_factors" FOR ALL TO "web_auth_role"
  USING (true) WITH CHECK (true);--> statement-breakpoint

-- Accepting an invite: look it up by fingerprint, then mark it accepted. Only
-- `accepted_at` may change; sending and revoking stay with the admin app.
GRANT SELECT ON "operator_invites" TO "web_auth_role";--> statement-breakpoint
GRANT UPDATE ("accepted_at") ON "operator_invites" TO "web_auth_role";--> statement-breakpoint
CREATE POLICY "operator_invites_auth_all" ON "operator_invites" FOR ALL TO "web_auth_role"
  USING (true) WITH CHECK (true);--> statement-breakpoint

-- Enough of each Operator to refuse a suspended one and to word its emails.
GRANT SELECT ("id", "legal_name", "trading_name", "timezone", "suspended_at", "archived_at")
  ON "operators" TO "web_auth_role";--> statement-breakpoint
CREATE POLICY "operators_auth_read" ON "operators" FOR SELECT TO "web_auth_role"
  USING (true);--> statement-breakpoint

-- Sign-ins, failures and lockouts go in the Operator's history. Write-only:
-- the login system has no reason to read anyone's history.
GRANT INSERT ON "activity_log" TO "web_auth_role";--> statement-breakpoint
CREATE POLICY "activity_log_auth_write" ON "activity_log" FOR INSERT TO "web_auth_role"
  WITH CHECK (true);--> statement-breakpoint

-- Password reset and new-device emails are sent by the login system.
GRANT INSERT ON "dev_email_outbox" TO "web_auth_role";--> statement-breakpoint
CREATE POLICY "dev_email_outbox_auth_write" ON "dev_email_outbox" FOR INSERT TO "web_auth_role"
  WITH CHECK (true);
