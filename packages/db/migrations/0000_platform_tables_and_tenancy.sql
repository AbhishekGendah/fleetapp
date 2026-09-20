CREATE TYPE "public"."actor_type" AS ENUM('user', 'admin', 'system', 'renter_link');--> statement-breakpoint
CREATE TYPE "public"."australian_state" AS ENUM('NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trial', 'active', 'past_due', 'read_only', 'cancelled');--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"values_before" jsonb,
	"values_after" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "operators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" text NOT NULL,
	"trading_name" text,
	"abn" varchar(11),
	"gst_registered" boolean DEFAULT false NOT NULL,
	"gst_registered_from" date,
	"address_line1" text,
	"address_line2" text,
	"suburb" text,
	"state" "australian_state",
	"postcode" varchar(4),
	"phone" text,
	"email" text,
	"logo_file_key" text,
	"timezone" text DEFAULT 'Australia/Perth' NOT NULL,
	"stripe_account_id" text,
	"stripe_charges_enabled" boolean DEFAULT false NOT NULL,
	"stripe_payouts_enabled" boolean DEFAULT false NOT NULL,
	"stripe_becs_capability_status" text,
	"subscription_status" "subscription_status" DEFAULT 'trial' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "operators_stripe_account_id_unique" UNIQUE("stripe_account_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_log_entity_idx" ON "activity_log" USING btree ("operator_id","entity_type","entity_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_log_operator_occurred_at_idx" ON "activity_log" USING btree ("operator_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_email_unique" ON "admin_users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_operator_id_idx" ON "users" USING btree ("operator_id");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Tenancy and row-level security.
--
-- Hand-written and appended to the generated migration on purpose: drizzle-kit
-- does not emit FORCE ROW LEVEL SECURITY, grants or triggers, and splitting
-- this into a second migration would leave a window in which the tables exist
-- with no security on them. One file, one transaction, no window.
--
-- Note for future data migrations: RLS is FORCED, so the owner role is subject
-- to it too and no policy grants the owner access. Owner-run DDL is fine;
-- owner-run data changes will see no rows. Do data work through the app roles.
-- ---------------------------------------------------------------------------

CREATE SCHEMA "app";--> statement-breakpoint

-- The Operator whose rows the current transaction may touch. Returns NULL when
-- no tenant context has been set, which makes every policy below fail closed:
-- `operator_id = NULL` is NULL, so no rows match, rather than all of them.
CREATE FUNCTION "app"."current_operator_id"() RETURNS uuid
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog
  AS $$ SELECT nullif(current_setting('app.operator_id', true), '')::uuid $$;--> statement-breakpoint

CREATE FUNCTION "app"."reject_mutation"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
  AS $$
  BEGIN
    RAISE EXCEPTION 'Table % is append-only; % is not allowed.', TG_TABLE_NAME, TG_OP
      USING ERRCODE = 'restrict_violation';
  END;
  $$;--> statement-breakpoint

GRANT USAGE ON SCHEMA "public" TO "web_app_role", "admin_app_role";--> statement-breakpoint
GRANT USAGE ON SCHEMA "app" TO "web_app_role", "admin_app_role";--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."current_operator_id"() TO "web_app_role", "admin_app_role";--> statement-breakpoint

-- No role is granted DELETE on anything: core records are archived, never
-- hard-deleted (rule 13).
ALTER TABLE "operators" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "operators" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, UPDATE ON "operators" TO "web_app_role";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "operators" TO "admin_app_role";--> statement-breakpoint
CREATE POLICY "operators_web_tenant" ON "operators" FOR ALL TO "web_app_role"
  USING ("id" = "app"."current_operator_id"())
  WITH CHECK ("id" = "app"."current_operator_id"());--> statement-breakpoint
CREATE POLICY "operators_admin_all" ON "operators" FOR ALL TO "admin_app_role"
  USING (true) WITH CHECK (true);--> statement-breakpoint

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, UPDATE ON "users" TO "web_app_role";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "users" TO "admin_app_role";--> statement-breakpoint
CREATE POLICY "users_web_tenant" ON "users" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
CREATE POLICY "users_admin_all" ON "users" FOR ALL TO "admin_app_role"
  USING (true) WITH CHECK (true);--> statement-breakpoint

ALTER TABLE "activity_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activity_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "activity_log" TO "web_app_role";--> statement-breakpoint
GRANT SELECT, INSERT ON "activity_log" TO "admin_app_role";--> statement-breakpoint
CREATE POLICY "activity_log_web_tenant_read" ON "activity_log" FOR SELECT TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
CREATE POLICY "activity_log_web_tenant_write" ON "activity_log" FOR INSERT TO "web_app_role"
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
CREATE POLICY "activity_log_admin_read" ON "activity_log" FOR SELECT TO "admin_app_role"
  USING (true);--> statement-breakpoint
CREATE POLICY "activity_log_admin_write" ON "activity_log" FOR INSERT TO "admin_app_role"
  WITH CHECK (true);--> statement-breakpoint
CREATE TRIGGER "activity_log_append_only"
  BEFORE UPDATE OR DELETE ON "activity_log"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint

-- AGS staff. apps/web's role is granted nothing here and has no policy, so it
-- is locked out twice over.
ALTER TABLE "admin_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "admin_users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "admin_users" TO "admin_app_role";--> statement-breakpoint
CREATE POLICY "admin_users_admin_all" ON "admin_users" FOR ALL TO "admin_app_role"
  USING (true) WITH CHECK (true);
