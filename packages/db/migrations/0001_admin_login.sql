CREATE TABLE "admin_activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid,
	"action" text NOT NULL,
	"ip_address" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"password" text,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_two_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean,
	"failed_verification_count" integer,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "admin_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_accounts" ADD CONSTRAINT "admin_accounts_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_two_factors" ADD CONSTRAINT "admin_two_factors_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_activity_log_admin_user_id_idx" ON "admin_activity_log" USING btree ("admin_user_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "admin_activity_log_occurred_at_idx" ON "admin_activity_log" USING btree ("occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "admin_accounts_admin_user_id_idx" ON "admin_accounts" USING btree ("admin_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_sessions_token_unique" ON "admin_sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "admin_sessions_admin_user_id_idx" ON "admin_sessions" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "admin_two_factors_admin_user_id_idx" ON "admin_two_factors" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "admin_verifications_identifier_idx" ON "admin_verifications" USING btree ("identifier");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Admin login security.
--
-- `admin_auth_role` is a third database role used only by the login system. It
-- reaches the credential tables below; `admin_app_role`, which runs the rest
-- of the admin app, is granted nothing on them. A bug in an Operator list or a
-- report therefore has no connection on which a password hash or an
-- authenticator secret is readable.
--
-- The role must already exist. Roles are cluster-level objects that Neon
-- manages, so creating one here would work locally and fail where it matters.
-- ---------------------------------------------------------------------------

-- Migration 0000 granted table-level UPDATE on admin_users, which now covers
-- the two columns added above. Those two decide whether an Admin has to
-- present an authenticator code, so the role running the ordinary admin app
-- must not be able to write them: it could otherwise switch an Admin's second
-- factor off. Narrowed to a column-level grant, as on `operators`.
REVOKE UPDATE ON "admin_users" FROM "admin_app_role";--> statement-breakpoint
GRANT UPDATE (
  "email",
  "full_name",
  "image",
  "archived_at",
  "updated_at"
) ON "admin_users" TO "admin_app_role";--> statement-breakpoint

ALTER TABLE "admin_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_verifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_verifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_two_factors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_two_factors" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_activity_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_activity_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- The login system needs to read an Admin by email before anyone is signed in,
-- and to set `two_factor_enabled` once enrolment finishes.
GRANT SELECT, INSERT, UPDATE ON "admin_users" TO "admin_auth_role";--> statement-breakpoint
CREATE POLICY "admin_users_auth_all" ON "admin_users" FOR ALL TO "admin_auth_role"
  USING (true) WITH CHECK (true);--> statement-breakpoint

-- DELETE is granted on sessions, reset tokens and authenticator enrolments
-- because signing out, consuming a reset link and turning off two-factor are
-- all deletions. Leaving those rows behind would be the security problem.
-- `admin_accounts` deliberately gets no DELETE: that row IS the Admin's
-- credential, and removing one is not something the app should be able to do.
GRANT SELECT, INSERT, UPDATE, DELETE ON "admin_sessions" TO "admin_auth_role";--> statement-breakpoint
CREATE POLICY "admin_sessions_auth_all" ON "admin_sessions" FOR ALL TO "admin_auth_role"
  USING (true) WITH CHECK (true);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON "admin_accounts" TO "admin_auth_role";--> statement-breakpoint
CREATE POLICY "admin_accounts_auth_all" ON "admin_accounts" FOR ALL TO "admin_auth_role"
  USING (true) WITH CHECK (true);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "admin_verifications" TO "admin_auth_role";--> statement-breakpoint
CREATE POLICY "admin_verifications_auth_all" ON "admin_verifications" FOR ALL TO "admin_auth_role"
  USING (true) WITH CHECK (true);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "admin_two_factors" TO "admin_auth_role";--> statement-breakpoint
CREATE POLICY "admin_two_factors_auth_all" ON "admin_two_factors" FOR ALL TO "admin_auth_role"
  USING (true) WITH CHECK (true);--> statement-breakpoint

-- Both roles append to the Admin audit trail: the login system records
-- sign-ins and failures, the admin app records what an Admin then did.
-- Neither can change or remove an entry.
GRANT SELECT, INSERT ON "admin_activity_log" TO "admin_auth_role";--> statement-breakpoint
GRANT SELECT, INSERT ON "admin_activity_log" TO "admin_app_role";--> statement-breakpoint
CREATE POLICY "admin_activity_log_auth_read" ON "admin_activity_log" FOR SELECT TO "admin_auth_role"
  USING (true);--> statement-breakpoint
CREATE POLICY "admin_activity_log_auth_write" ON "admin_activity_log" FOR INSERT TO "admin_auth_role"
  WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "admin_activity_log_app_read" ON "admin_activity_log" FOR SELECT TO "admin_app_role"
  USING (true);--> statement-breakpoint
CREATE POLICY "admin_activity_log_app_write" ON "admin_activity_log" FOR INSERT TO "admin_app_role"
  WITH CHECK (true);--> statement-breakpoint
CREATE TRIGGER "admin_activity_log_append_only"
  BEFORE UPDATE OR DELETE ON "admin_activity_log"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();
