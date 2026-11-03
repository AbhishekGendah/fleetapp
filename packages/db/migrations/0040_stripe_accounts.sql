CREATE TYPE "public"."stripe_capability_status" AS ENUM('active', 'pending', 'rejected', 'restricted', 'unsupported');--> statement-breakpoint
CREATE TABLE "stripe_accounts" (
	"operator_id" uuid PRIMARY KEY NOT NULL,
	"stripe_account_id" text NOT NULL,
	"is_live" boolean NOT NULL,
	"card_payments" "stripe_capability_status" DEFAULT 'pending' NOT NULL,
	"becs_debit_payments" "stripe_capability_status" DEFAULT 'pending' NOT NULL,
	"requirements_due" integer DEFAULT 0 NOT NULL,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_accounts_stripe_account_id_unique" UNIQUE("stripe_account_id"),
	CONSTRAINT "stripe_accounts_id_shape" CHECK ("stripe_accounts"."stripe_account_id" ~ '^acct_[A-Za-z0-9]+$'),
	CONSTRAINT "stripe_accounts_requirements" CHECK ("stripe_accounts"."requirements_due" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"operator_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stripe_accounts" ADD CONSTRAINT "stripe_accounts_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_events" ADD CONSTRAINT "stripe_events_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- The business's own, and the Operator app's only: the admin logins get nothing
-- (rule 5). The status columns are written only from what Stripe returns.
ALTER TABLE "stripe_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stripe_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "stripe_accounts" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("card_payments", "becs_debit_payments", "requirements_due", "checked_at", "updated_at") ON "stripe_accounts" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "stripe_accounts_web_tenant" ON "stripe_accounts" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
CREATE TRIGGER "stripe_accounts_no_delete"
  BEFORE DELETE ON "stripe_accounts"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "stripe_accounts_no_truncate"
  BEFORE TRUNCATE ON "stripe_accounts"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint

-- Stripe's events have no session (rule 3). Each event's business is found
-- only from the Stripe account it is about, through this narrow function
-- that maps one account ID to one business ID and nothing else.
--
-- The events table belongs to no business: no role but the owner can read
-- or write it, and only through record_stripe_event. As for rentals in
-- 0038, the owner gets policies so these SECURITY DEFINER functions see the
-- rows; the owner owns the tables and could lift row-level security anyway.
ALTER TABLE "stripe_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stripe_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY "stripe_accounts_owner_lookup" ON "stripe_accounts" FOR SELECT TO %I USING (true)',
    current_user
  );
  EXECUTE format(
    'CREATE POLICY "stripe_events_owner" ON "stripe_events" FOR ALL TO %I USING (true) WITH CHECK (true)',
    current_user
  );
END
$$;--> statement-breakpoint
CREATE FUNCTION "app"."operator_for_stripe_account"("account_id" text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT "operator_id" FROM "public"."stripe_accounts" WHERE "stripe_account_id" = "account_id"
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."operator_for_stripe_account"(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."operator_for_stripe_account"(text) TO "web_app_role";--> statement-breakpoint

-- Records an event once (rule 20): true the first time, false for a repeat.
-- Called inside the business's own tenant context, in the transaction that
-- handles the event, so a failure records nothing and Stripe's retry is
-- handled. The business named must be the one whose context is set.
CREATE FUNCTION "app"."record_stripe_event"(
  "id" text,
  "kind" text,
  "business" uuid
) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  inserted integer;
BEGIN
  IF "business" IS NOT NULL AND "business" IS DISTINCT FROM "app"."current_operator_id"() THEN
    RAISE EXCEPTION 'an event is recorded only in its own business''s context'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO "public"."stripe_events" ("event_id", "event_type", "operator_id")
    VALUES ("id", "kind", "business")
    ON CONFLICT ("event_id") DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted > 0;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."record_stripe_event"(text, text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."record_stripe_event"(text, text, uuid) TO "web_app_role";
