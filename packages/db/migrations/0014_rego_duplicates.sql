-- Before the new rules: test data may already hold the same renewal twice, or
-- two direct debits running on one car. The earliest entered is kept; the
-- others are removed (archived) or stopped today, each logged as a system
-- change. Forced row-level security hides every row from the owner, so it is
-- lifted for these updates, inside this migration's transaction.
ALTER TABLE "vehicle_registrations" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activity_log" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
WITH ranked AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "operator_id", "vehicle_id", "expires_on" ORDER BY "created_at", "id"
  ) AS place
  FROM "vehicle_registrations"
  WHERE "archived_at" IS NULL AND "expires_on" IS NOT NULL
), archived AS (
  UPDATE "vehicle_registrations" SET "archived_at" = now()
  WHERE "id" IN (SELECT "id" FROM ranked WHERE place > 1)
  RETURNING "id", "operator_id"
)
INSERT INTO "activity_log" ("operator_id", "actor_type", "actor_id", "entity_type", "entity_id", "action")
SELECT "operator_id", 'system', NULL, 'vehicle_registration', "id", 'archived' FROM archived;--> statement-breakpoint
WITH ranked AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "operator_id", "vehicle_id" ORDER BY "created_at", "id"
  ) AS place
  FROM "vehicle_registrations"
  WHERE "archived_at" IS NULL AND "expires_on" IS NULL AND "direct_debit_stopped_on" IS NULL
), stopped AS (
  UPDATE "vehicle_registrations" SET "direct_debit_stopped_on" = current_date
  WHERE "id" IN (SELECT "id" FROM ranked WHERE place > 1)
  RETURNING "id", "operator_id", "direct_debit_stopped_on"
)
INSERT INTO "activity_log" ("operator_id", "actor_type", "actor_id", "entity_type", "entity_id", "action", "values_before", "values_after")
SELECT "operator_id", 'system', NULL, 'vehicle_registration', "id", 'updated',
  jsonb_build_object('directDebitStoppedOn', NULL),
  jsonb_build_object('directDebitStoppedOn', "direct_debit_stopped_on")
FROM stopped;--> statement-breakpoint
ALTER TABLE "activity_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vehicle_registrations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_registrations_one_per_expiry" ON "vehicle_registrations" USING btree ("operator_id","vehicle_id","expires_on") WHERE "vehicle_registrations"."archived_at" is null and "vehicle_registrations"."expires_on" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_registrations_one_direct_debit" ON "vehicle_registrations" USING btree ("operator_id","vehicle_id") WHERE "vehicle_registrations"."archived_at" is null and "vehicle_registrations"."expires_on" is null and "vehicle_registrations"."direct_debit_stopped_on" is null;
