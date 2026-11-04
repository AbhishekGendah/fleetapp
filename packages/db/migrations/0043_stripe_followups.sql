CREATE TYPE "public"."checkout_purpose" AS ENUM('direct_debit', 'bond');--> statement-breakpoint
CREATE TYPE "public"."checkout_status" AS ENUM('open', 'complete', 'expired');--> statement-breakpoint
CREATE TABLE "renter_link_attempts" (
	"operator_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"action" text NOT NULL,
	"hour_starts_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "renter_link_attempts_link_id_action_hour_starts_at_pk" PRIMARY KEY("link_id","action","hour_starts_at"),
	CONSTRAINT "renter_link_attempts_action" CHECK ("renter_link_attempts"."action" in ('stripePages', 'licencePhotos')),
	CONSTRAINT "renter_link_attempts_count" CHECK ("renter_link_attempts"."attempts" > 0)
);
--> statement-breakpoint
CREATE TABLE "stripe_checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"rental_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"purpose" "checkout_purpose" NOT NULL,
	"amount_cents" integer,
	"stripe_checkout_session_id" text NOT NULL,
	"url" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "checkout_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_checkouts_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id"),
	CONSTRAINT "stripe_checkouts_amount" CHECK (("stripe_checkouts"."purpose" = 'bond') = ("stripe_checkouts"."amount_cents" is not null)
        and ("stripe_checkouts"."amount_cents" is null or "stripe_checkouts"."amount_cents" > 0)),
	CONSTRAINT "stripe_checkouts_id_shape" CHECK ("stripe_checkouts"."stripe_checkout_session_id" ~ '^cs_[A-Za-z0-9_]+$'),
	CONSTRAINT "stripe_checkouts_url" CHECK ("stripe_checkouts"."url" ~ '^https?://')
);
--> statement-breakpoint
ALTER TABLE "bond_movements" DROP CONSTRAINT "bond_movements_payment_id_unique";--> statement-breakpoint
ALTER TABLE "stripe_accounts" DROP CONSTRAINT "stripe_accounts_requirements";--> statement-breakpoint
ALTER TABLE "bond_movements" DROP CONSTRAINT "bond_movements_payment_received";--> statement-breakpoint
ALTER TABLE "stripe_accounts" ADD COLUMN "requirements_later" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stripe_accounts" ADD COLUMN "disconnected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bond_movements" ADD COLUMN "stripe_object_id" text;--> statement-breakpoint
ALTER TABLE "payment_mandates" ADD COLUMN "set_up_at" timestamp with time zone;--> statement-breakpoint
-- Those already recorded were set up when they were first recorded.
UPDATE "payment_mandates" SET "set_up_at" = "created_at";--> statement-breakpoint
ALTER TABLE "payment_mandates" ALTER COLUMN "set_up_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_mandates" ADD COLUMN "detached_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "renter_stripe_customers" ADD COLUMN "needs_update" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "renter_link_attempts" ADD CONSTRAINT "renter_link_attempts_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renter_link_attempts" ADD CONSTRAINT "renter_link_attempts_link_fk" FOREIGN KEY ("link_id","operator_id") REFERENCES "public"."renter_links"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_checkouts" ADD CONSTRAINT "stripe_checkouts_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_checkouts" ADD CONSTRAINT "stripe_checkouts_rental_fk" FOREIGN KEY ("rental_id","operator_id") REFERENCES "public"."rentals"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_checkouts" ADD CONSTRAINT "stripe_checkouts_link_fk" FOREIGN KEY ("link_id","operator_id") REFERENCES "public"."renter_links"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_checkouts_one_open_bond" ON "stripe_checkouts" USING btree ("operator_id","rental_id") WHERE "stripe_checkouts"."status" = 'open' and "stripe_checkouts"."purpose" = 'bond';--> statement-breakpoint
CREATE INDEX "stripe_checkouts_rental_idx" ON "stripe_checkouts" USING btree ("operator_id","rental_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bond_movements_one_per_payment" ON "bond_movements" USING btree ("payment_id") WHERE "bond_movements"."kind" = 'received' and "bond_movements"."stripe_object_id" is null;--> statement-breakpoint
ALTER TABLE "bond_movements" ADD CONSTRAINT "bond_movements_stripe_object_once" UNIQUE("stripe_object_id","kind");--> statement-breakpoint
ALTER TABLE "stripe_accounts" ADD CONSTRAINT "stripe_accounts_requirements" CHECK ("stripe_accounts"."requirements_due" >= 0 and "stripe_accounts"."requirements_later" >= 0);--> statement-breakpoint
ALTER TABLE "bond_movements" ADD CONSTRAINT "bond_movements_payment_kind" CHECK ("bond_movements"."payment_id" is null or "bond_movements"."kind" in ('received', 'refunded'));--> statement-breakpoint
ALTER TABLE "bond_movements" ADD CONSTRAINT "bond_movements_stripe_object_shape" CHECK ("bond_movements"."stripe_object_id" is null or "bond_movements"."stripe_object_id" ~ '^(re|pyr|du)_[A-Za-z0-9]+$');--> statement-breakpoint

-- A bond entry tied to a payment matches it: the money in once Stripe says
-- the bond payment succeeded (exactly its amount), a dispute won putting
-- back no more than was paid, or a refund or dispute taking back no more
-- than was paid, the same way it came in.
CREATE OR REPLACE FUNCTION "app"."check_bond_payment"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  paid "payments"%ROWTYPE;
BEGIN
  IF NEW.payment_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO paid FROM "payments" WHERE id = NEW.payment_id;
  IF paid.purpose <> 'bond' OR paid.method <> NEW.method
    OR paid.status NOT IN ('succeeded', 'refunded')
    OR NEW.amount_cents > paid.amount_cents
    OR (NEW.kind = 'received' AND NEW.stripe_object_id IS NULL
      AND (paid.status <> 'succeeded' OR NEW.amount_cents <> paid.amount_cents))
    OR (NEW.kind = 'refunded' AND NEW.stripe_object_id IS NULL) THEN
    RAISE EXCEPTION 'a bond entry from a payment must match a succeeded bond payment'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint

-- A Renter's Stripe customer never changes, except to note that Stripe
-- still has to be told a new name or email (review A5-6).
CREATE FUNCTION "app"."check_stripe_customer_change"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (to_jsonb(NEW) - 'needs_update') <> (to_jsonb(OLD) - 'needs_update') THEN
    RAISE EXCEPTION 'a Renter''s Stripe customer cannot be changed or deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;--> statement-breakpoint
DROP TRIGGER "renter_stripe_customers_fixed" ON "renter_stripe_customers";--> statement-breakpoint
CREATE TRIGGER "renter_stripe_customers_fixed"
  BEFORE UPDATE OR DELETE ON "renter_stripe_customers"
  FOR EACH ROW EXECUTE FUNCTION "app"."check_stripe_customer_change"();--> statement-breakpoint

-- A Stripe page we opened only moves from open to finished or expired; its
-- amount, address and Stripe ID never change, and none is deleted (rule 13).
CREATE FUNCTION "app"."check_checkout_change"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'status' - 'updated_at') <> (to_jsonb(OLD) - 'status' - 'updated_at')
    OR (NEW.status <> OLD.status AND OLD.status <> 'open') THEN
    RAISE EXCEPTION 'a Stripe page can only go from open to finished or expired'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "stripe_checkouts_forward"
  BEFORE UPDATE ON "stripe_checkouts"
  FOR EACH ROW EXECUTE FUNCTION "app"."check_checkout_change"();--> statement-breakpoint
CREATE TRIGGER "stripe_checkouts_no_delete"
  BEFORE DELETE ON "stripe_checkouts"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "stripe_checkouts_no_truncate"
  BEFORE TRUNCATE ON "stripe_checkouts"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint

-- The business's own, and the Operator app's only: the admin logins get
-- nothing (rule 5). Only the columns that move can be updated.
ALTER TABLE "stripe_checkouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stripe_checkouts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "stripe_checkouts" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("status", "updated_at") ON "stripe_checkouts" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "stripe_checkouts_web_tenant" ON "stripe_checkouts" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
ALTER TABLE "renter_link_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "renter_link_attempts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "renter_link_attempts" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("attempts") ON "renter_link_attempts" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "renter_link_attempts_web_tenant" ON "renter_link_attempts" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
GRANT UPDATE ("detached_at") ON "payment_mandates" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("needs_update") ON "renter_stripe_customers" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("requirements_later", "disconnected_at") ON "stripe_accounts" TO "web_app_role";
--> statement-breakpoint

-- As for stripe_accounts in 0040, the owner gets read policies so the
-- SECURITY DEFINER function below sees the rows it looks for.
DO $$
BEGIN
  EXECUTE format(
    'CREATE POLICY "payment_mandates_owner_lookup" ON "payment_mandates" FOR SELECT TO %I USING (true)',
    current_user
  );
  EXECUTE format(
    'CREATE POLICY "renter_stripe_customers_owner_lookup" ON "renter_stripe_customers" FOR SELECT TO %I USING (true)',
    current_user
  );
END
$$;--> statement-breakpoint

-- The businesses with Stripe tidying up still to do: a replaced direct debit
-- not yet detached at Stripe (review KS-3), or a Renter's new name or email
-- Stripe has not been told (review A5-6). IDs only (rule 3); the nightly run
-- then works in each business's own tenant context.
CREATE FUNCTION "app"."operators_with_stripe_tidy_up"() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT "m"."operator_id" FROM "public"."payment_mandates" "m"
  WHERE "m"."end_reason" = 'replaced' AND "m"."detached_at" IS NULL
  UNION
  SELECT "c"."operator_id" FROM "public"."renter_stripe_customers" "c"
  WHERE "c"."needs_update"
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."operators_with_stripe_tidy_up"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."operators_with_stripe_tidy_up"() TO "web_app_role";
