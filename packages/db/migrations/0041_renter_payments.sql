CREATE TYPE "public"."mandate_end_reason" AS ENUM('cancelled', 'replaced');--> statement-breakpoint
CREATE TYPE "public"."mandate_status" AS ENUM('waiting', 'active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."payment_purpose" AS ENUM('bond');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'succeeded', 'failed', 'refunded');--> statement-breakpoint
ALTER TYPE "public"."renter_link_purpose" ADD VALUE 'set_up_payments';--> statement-breakpoint
CREATE TABLE "payment_mandates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"renter_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"status" "mandate_status" NOT NULL,
	"end_reason" "mandate_end_reason",
	"stripe_setup_intent_id" text NOT NULL,
	"stripe_payment_method_id" text NOT NULL,
	"stripe_mandate_id" text NOT NULL,
	"link_id" uuid,
	"activated_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_mandates_stripe_setup_intent_id_unique" UNIQUE("stripe_setup_intent_id"),
	CONSTRAINT "payment_mandates_stripe_mandate_id_unique" UNIQUE("stripe_mandate_id"),
	CONSTRAINT "payment_mandates_method" CHECK ("payment_mandates"."method" = 'becs_debit'),
	CONSTRAINT "payment_mandates_ended" CHECK (("payment_mandates"."status" = 'inactive') = ("payment_mandates"."end_reason" is not null)
        and ("payment_mandates"."end_reason" is null) = ("payment_mandates"."ended_at" is null)),
	CONSTRAINT "payment_mandates_id_shapes" CHECK ("payment_mandates"."stripe_setup_intent_id" ~ '^seti_[A-Za-z0-9]+$'
        and "payment_mandates"."stripe_payment_method_id" ~ '^pm_[A-Za-z0-9]+$'
        and "payment_mandates"."stripe_mandate_id" ~ '^mandate_[A-Za-z0-9]+$')
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"renter_id" uuid NOT NULL,
	"rental_id" uuid NOT NULL,
	"purpose" "payment_purpose" NOT NULL,
	"method" "payment_method" NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" "payment_status" NOT NULL,
	"stripe_checkout_session_id" text NOT NULL,
	"stripe_payment_intent_id" text NOT NULL,
	"failure_code" text,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id"),
	CONSTRAINT "payments_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id"),
	CONSTRAINT "payments_id_rental_unique" UNIQUE("id","operator_id","rental_id"),
	CONSTRAINT "payments_amount" CHECK ("payments"."amount_cents" > 0),
	CONSTRAINT "payments_method" CHECK ("payments"."method" in ('card', 'becs_debit')),
	CONSTRAINT "payments_settled" CHECK (("payments"."status" = 'pending') = ("payments"."settled_at" is null)),
	CONSTRAINT "payments_id_shapes" CHECK ("payments"."stripe_checkout_session_id" ~ '^cs_[A-Za-z0-9_]+$'
        and "payments"."stripe_payment_intent_id" ~ '^pi_[A-Za-z0-9]+$')
);
--> statement-breakpoint
CREATE TABLE "renter_stripe_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"renter_id" uuid NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "renter_stripe_customers_stripe_customer_id_unique" UNIQUE("stripe_customer_id"),
	CONSTRAINT "renter_stripe_customers_one_per_renter" UNIQUE("operator_id","renter_id"),
	CONSTRAINT "renter_stripe_customers_id_shape" CHECK ("renter_stripe_customers"."stripe_customer_id" ~ '^cus_[A-Za-z0-9]+$')
);
--> statement-breakpoint
ALTER TABLE "renter_links" DROP CONSTRAINT "renter_links_signing_details";--> statement-breakpoint
ALTER TABLE "bond_movements" ADD COLUMN "payment_id" uuid;--> statement-breakpoint
ALTER TABLE "inspections" ADD COLUMN "direct_debit_override_reason" text;--> statement-breakpoint
ALTER TABLE "payment_mandates" ADD CONSTRAINT "payment_mandates_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_mandates" ADD CONSTRAINT "payment_mandates_renter_fk" FOREIGN KEY ("renter_id","operator_id") REFERENCES "public"."renters"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_mandates" ADD CONSTRAINT "payment_mandates_link_fk" FOREIGN KEY ("link_id","renter_id","operator_id") REFERENCES "public"."renter_links"("id","renter_id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_rental_fk" FOREIGN KEY ("rental_id","operator_id") REFERENCES "public"."rentals"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_renter_fk" FOREIGN KEY ("renter_id","operator_id") REFERENCES "public"."renters"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renter_stripe_customers" ADD CONSTRAINT "renter_stripe_customers_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renter_stripe_customers" ADD CONSTRAINT "renter_stripe_customers_renter_fk" FOREIGN KEY ("renter_id","operator_id") REFERENCES "public"."renters"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_mandates_one_active" ON "payment_mandates" USING btree ("operator_id","renter_id") WHERE "payment_mandates"."status" = 'active';--> statement-breakpoint
CREATE INDEX "payment_mandates_renter_idx" ON "payment_mandates" USING btree ("operator_id","renter_id");--> statement-breakpoint
CREATE INDEX "payments_rental_idx" ON "payments" USING btree ("operator_id","rental_id");--> statement-breakpoint
ALTER TABLE "bond_movements" ADD CONSTRAINT "bond_movements_payment_fk" FOREIGN KEY ("payment_id","operator_id","rental_id") REFERENCES "public"."payments"("id","operator_id","rental_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bond_movements" ADD CONSTRAINT "bond_movements_payment_id_unique" UNIQUE("payment_id");--> statement-breakpoint
ALTER TABLE "renter_links" ADD CONSTRAINT "renter_links_signing_details" CHECK (("renter_links"."purpose"::text in ('sign_contract', 'sign_change', 'set_up_payments')) = ("renter_links"."rental_id" is not null)
        and ("renter_links"."purpose"::text = 'sign_change') = ("renter_links"."rental_change_id" is not null)
        and ("renter_links"."purpose"::text in ('sign_contract', 'sign_change')) = ("renter_links"."template_version_id" is not null)
        and ("renter_links"."template_version_id" is null) = ("renter_links"."contract_fingerprint" is null)
        and ("renter_links"."contract_fingerprint" is null or "renter_links"."contract_fingerprint" ~ '^[0-9a-f]{64}$'));--> statement-breakpoint
ALTER TABLE "bond_movements" ADD CONSTRAINT "bond_movements_payment_received" CHECK ("bond_movements"."payment_id" is null or "bond_movements"."kind" = 'received');--> statement-breakpoint

-- A payment's amount, method and Stripe IDs never change; its status only
-- moves forward, as Stripe reports it: pending to succeeded or failed, and
-- succeeded to refunded (docs/design/06, decision 2).
CREATE FUNCTION "app"."check_payment_change"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT (
    (OLD.status = 'pending' AND NEW.status IN ('succeeded', 'failed'))
    OR (OLD.status = 'succeeded' AND NEW.status = 'refunded')
  ) THEN
    RAISE EXCEPTION 'a payment cannot go from % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "payments_status_forward"
  BEFORE UPDATE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "app"."check_payment_change"();--> statement-breakpoint

-- A bond entry made from a payment is for exactly that payment: a bond
-- payment Stripe says succeeded, for the same amount.
CREATE FUNCTION "app"."check_bond_payment"() RETURNS trigger
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
  IF paid.purpose <> 'bond' OR paid.status <> 'succeeded' OR paid.amount_cents <> NEW.amount_cents
    OR paid.method <> NEW.method THEN
    RAISE EXCEPTION 'a bond entry from a payment must match a succeeded bond payment'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "bond_movements_payment_checked"
  AFTER INSERT ON "bond_movements"
  FOR EACH ROW EXECUTE FUNCTION "app"."check_bond_payment"();--> statement-breakpoint

-- Records, not drafts: none is ever deleted (rule 13).
CREATE TRIGGER "payments_no_delete"
  BEFORE DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "payments_no_truncate"
  BEFORE TRUNCATE ON "payments"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "payment_mandates_no_delete"
  BEFORE DELETE ON "payment_mandates"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "payment_mandates_no_truncate"
  BEFORE TRUNCATE ON "payment_mandates"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "renter_stripe_customers_fixed"
  BEFORE UPDATE OR DELETE ON "renter_stripe_customers"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "renter_stripe_customers_no_truncate"
  BEFORE TRUNCATE ON "renter_stripe_customers"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint

-- The business's own, and the Operator app's only: the admin logins get
-- nothing (rule 5). Only the columns Stripe's reports change can be updated.
ALTER TABLE "renter_stripe_customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "renter_stripe_customers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "renter_stripe_customers" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "renter_stripe_customers_web_tenant" ON "renter_stripe_customers" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
ALTER TABLE "payment_mandates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_mandates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "payment_mandates" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("status", "end_reason", "activated_at", "ended_at", "updated_at") ON "payment_mandates" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "payment_mandates_web_tenant" ON "payment_mandates" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "payments" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("status", "failure_code", "settled_at", "updated_at") ON "payments" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "payments_web_tenant" ON "payments" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());
--> statement-breakpoint
GRANT UPDATE ("direct_debit_override_reason") ON "inspections" TO "web_app_role";
