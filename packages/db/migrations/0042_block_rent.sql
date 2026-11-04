CREATE TYPE "public"."rent_model" AS ENUM('weekday', 'blocks');--> statement-breakpoint
ALTER TYPE "public"."built_in_charge_type" ADD VALUE 'daily_rent' BEFORE 'part_week_rent';--> statement-breakpoint
ALTER TABLE "rental_rates" DROP CONSTRAINT "rental_rates_amount";--> statement-breakpoint
ALTER TABLE "rental_changes" DROP CONSTRAINT "rental_changes_rate_values";--> statement-breakpoint
ALTER TABLE "rental_rates" ALTER COLUMN "weekly_rate_cents" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "rental_rates" ALTER COLUMN "applies_from" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "daily_rate_cents" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "long_term_weekly_cents" integer;--> statement-breakpoint
ALTER TABLE "rental_rates" ADD COLUMN "daily_rate_cents" integer;--> statement-breakpoint
ALTER TABLE "rental_rates" ADD COLUMN "applies_from_block" integer;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "rent_model" "rent_model" DEFAULT 'weekday' NOT NULL;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "is_long_term" boolean;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "grace_minutes" smallint;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "long_term_minimum_days" smallint;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "booked_blocks" integer;--> statement-breakpoint
ALTER TABLE "rentals" ADD COLUMN "daily_rate_waived_reason" text;--> statement-breakpoint
ALTER TABLE "rental_changes" ADD COLUMN "applies_from_block" integer;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD COLUMN "period_starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD COLUMN "period_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD COLUMN "is_correction" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_lines_one_block_rent_per_period" ON "ledger_lines" USING btree ("operator_id","rental_id","period_starts_at") WHERE "ledger_lines"."kind" = 'charge' and not "ledger_lines"."is_correction" and "ledger_lines"."period_starts_at" is not null;--> statement-breakpoint
ALTER TABLE "rental_rates" ADD CONSTRAINT "rental_rates_rental_block_unique" UNIQUE("operator_id","rental_id","applies_from_block");--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_rates" CHECK (("vehicles"."daily_rate_cents" is null or "vehicles"."daily_rate_cents" > 0)
        and ("vehicles"."long_term_weekly_cents" is null or "vehicles"."long_term_weekly_cents" > 0));--> statement-breakpoint
ALTER TABLE "rental_rates" ADD CONSTRAINT "rental_rates_start" CHECK (("rental_rates"."applies_from" is null) <> ("rental_rates"."applies_from_block" is null)
        and ("rental_rates"."applies_from" is null or "rental_rates"."weekly_rate_cents" is not null)
        and ("rental_rates"."applies_from_block" is null
          or ("rental_rates"."applies_from_block" >= 0 and "rental_rates"."daily_rate_cents" is not null)));--> statement-breakpoint
ALTER TABLE "rental_rates" ADD CONSTRAINT "rental_rates_amount" CHECK (("rental_rates"."weekly_rate_cents" is null or "rental_rates"."weekly_rate_cents" > 0)
        and ("rental_rates"."daily_rate_cents" is null or "rental_rates"."daily_rate_cents" > 0));--> statement-breakpoint
ALTER TABLE "rentals" ADD CONSTRAINT "rentals_block_terms" CHECK (("rentals"."rent_model" = 'blocks') = ("rentals"."is_long_term" is not null
          and "rentals"."grace_minutes" is not null and "rentals"."long_term_minimum_days" is not null)
        and ("rentals"."grace_minutes" is null or "rentals"."grace_minutes" between 0 and 240)
        and ("rentals"."long_term_minimum_days" is null or "rentals"."long_term_minimum_days" between 1 and 90)
        and ("rentals"."booked_blocks" is null or "rentals"."booked_blocks" > 0)
        and ("rentals"."rent_model" = 'weekday' or "rentals"."is_long_term" or "rentals"."booked_blocks" is not null)
        and ("rentals"."daily_rate_waived_reason" is null
          or ("rentals"."is_long_term" and length(trim("rentals"."daily_rate_waived_reason")) > 0)));--> statement-breakpoint
ALTER TABLE "rental_changes" ADD CONSTRAINT "rental_changes_rate_values" CHECK (("rental_changes"."kind" = 'weekly_rate') = ("rental_changes"."rate_after_cents" is not null)
        and ("rental_changes"."rate_after_cents" is null or ("rental_changes"."rate_after_cents" > 0
          and "rental_changes"."rate_before_cents" > 0
          and ("rental_changes"."applies_from" is null) <> ("rental_changes"."applies_from_block" is null)))
        and ("rental_changes"."applies_from_block" is null or "rental_changes"."applies_from_block" > 0));--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_block_period" CHECK (("ledger_lines"."period_starts_at" is null) = ("ledger_lines"."period_ends_at" is null)
        and ("ledger_lines"."period_starts_at" is null or ("ledger_lines"."kind" in ('charge', 'credit')
          and "ledger_lines"."period_start" is null and "ledger_lines"."period_ends_at" > "ledger_lines"."period_starts_at"))
        and (not "ledger_lines"."is_correction" or "ledger_lines"."period_starts_at" is not null));--> statement-breakpoint

-- The Operator app sets a car's prices, and the reason it waived the daily-rate
-- re-pricing at a return. Every other new rental column is fixed at booking
-- (rule 14), so it gets no update grant.
GRANT UPDATE ("daily_rate_cents", "long_term_weekly_cents") ON "vehicles" TO "web_app_role";--> statement-breakpoint
GRANT UPDATE ("daily_rate_waived_reason") ON "rentals" TO "web_app_role";--> statement-breakpoint

-- Backs up the rent run (rule 20): an original block rent charge may not
-- overlap another original charge of the same rental, whatever the code does.
-- A trigger rather than an exclusion constraint, so the test rentals already on
-- the dev database are not checked again.
CREATE FUNCTION "app"."refuse_overlapping_block_rent"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.kind <> 'charge' OR NEW.is_correction OR NEW.period_starts_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "ledger_lines"
    WHERE operator_id = NEW.operator_id
      AND rental_id = NEW.rental_id
      AND kind = 'charge'
      AND NOT is_correction
      AND period_starts_at IS NOT NULL
      AND tstzrange(period_starts_at, period_ends_at) && tstzrange(NEW.period_starts_at, NEW.period_ends_at)
  ) THEN
    RAISE EXCEPTION 'this rental is already charged for part of that time'
      USING ERRCODE = 'exclusion_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "ledger_lines_no_overlapping_block_rent"
  BEFORE INSERT ON "ledger_lines"
  FOR EACH ROW EXECUTE FUNCTION "app"."refuse_overlapping_block_rent"();
