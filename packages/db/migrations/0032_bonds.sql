CREATE TYPE "public"."bond_movement_kind" AS ENUM('received', 'refunded', 'deducted', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'bank_transfer', 'card', 'becs_debit');--> statement-breakpoint
CREATE TABLE "bond_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"rental_id" uuid NOT NULL,
	"kind" "bond_movement_kind" NOT NULL,
	"amount_cents" integer NOT NULL,
	"method" "payment_method",
	"reference" text,
	"occurred_on" date NOT NULL,
	"note" text,
	"reverses_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bond_movements_id_rental_unique" UNIQUE("id","operator_id","rental_id"),
	CONSTRAINT "bond_movements_reversed_once" UNIQUE("reverses_id"),
	CONSTRAINT "bond_movements_amount" CHECK ("bond_movements"."amount_cents" > 0),
	CONSTRAINT "bond_movements_reversal" CHECK (("bond_movements"."kind" = 'reversal') = ("bond_movements"."reverses_id" is not null)),
	CONSTRAINT "bond_movements_method" CHECK (("bond_movements"."kind" in ('received', 'refunded')) = ("bond_movements"."method" is not null)),
	CONSTRAINT "bond_movements_note" CHECK ("bond_movements"."kind" not in ('deducted', 'reversal') or "bond_movements"."note" is not null)
);
--> statement-breakpoint
ALTER TABLE "bond_movements" ADD CONSTRAINT "bond_movements_operator_id_operators_id_fk" FOREIGN KEY ("operator_id") REFERENCES "public"."operators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bond_movements" ADD CONSTRAINT "bond_movements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bond_movements" ADD CONSTRAINT "bond_movements_rental_fk" FOREIGN KEY ("rental_id","operator_id") REFERENCES "public"."rentals"("id","operator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bond_movements" ADD CONSTRAINT "bond_movements_reverses_fk" FOREIGN KEY ("reverses_id","operator_id","rental_id") REFERENCES "public"."bond_movements"("id","operator_id","rental_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bond_movements_rental_idx" ON "bond_movements" USING btree ("operator_id","rental_id");--> statement-breakpoint

-- A reversal undoes one entry exactly: the same amount, and never another
-- reversal. The bond held can never go below nothing.
CREATE FUNCTION "app"."check_bond_movement"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  reversed_kind "bond_movement_kind";
  reversed_amount integer;
  held bigint;
BEGIN
  IF NEW.kind = 'reversal' THEN
    SELECT kind, amount_cents INTO reversed_kind, reversed_amount
      FROM "bond_movements" WHERE id = NEW.reverses_id;
    IF reversed_kind = 'reversal' THEN
      RAISE EXCEPTION 'a reversal cannot be reversed' USING ERRCODE = 'check_violation';
    END IF;
    IF reversed_amount <> NEW.amount_cents THEN
      RAISE EXCEPTION 'a reversal must be for the amount it undoes' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  SELECT coalesce(sum(CASE
      WHEN m.kind = 'received' THEN m.amount_cents
      WHEN m.kind IN ('refunded', 'deducted') THEN -m.amount_cents
      WHEN r.kind = 'received' THEN -m.amount_cents
      ELSE m.amount_cents
    END), 0) INTO held
    FROM "bond_movements" m
    LEFT JOIN "bond_movements" r ON r.id = m.reverses_id
    WHERE m.operator_id = NEW.operator_id AND m.rental_id = NEW.rental_id;
  IF held < 0 THEN
    RAISE EXCEPTION 'the bond held cannot go below nothing' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "bond_movements_checked"
  AFTER INSERT ON "bond_movements"
  FOR EACH ROW EXECUTE FUNCTION "app"."check_bond_movement"();--> statement-breakpoint

-- The bond account is a history: added to, never changed or removed.
CREATE TRIGGER "bond_movements_append_only"
  BEFORE UPDATE OR DELETE ON "bond_movements"
  FOR EACH ROW EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint
CREATE TRIGGER "bond_movements_no_truncate"
  BEFORE TRUNCATE ON "bond_movements"
  FOR EACH STATEMENT EXECUTE FUNCTION "app"."reject_mutation"();--> statement-breakpoint

-- The business's own, and the Operator app's only: the admin logins get nothing.
ALTER TABLE "bond_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bond_movements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "bond_movements" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "bond_movements_web_tenant" ON "bond_movements" FOR ALL TO "web_app_role"
  USING ("operator_id" = "app"."current_operator_id"())
  WITH CHECK ("operator_id" = "app"."current_operator_id"());
