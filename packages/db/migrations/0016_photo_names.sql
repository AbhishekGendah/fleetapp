ALTER TABLE "files" DROP CONSTRAINT "files_vehicle_purposes";--> statement-breakpoint
-- Photos added before names existed get one now, from the car's rego and
-- the day they were added on the Operator's clock, numbered in the order
-- they were added. Forced row-level security hides every row from the owner,
-- so it is lifted for this update, inside this migration's transaction.
ALTER TABLE "files" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vehicles" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "operators" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
WITH named AS (
  SELECT "files"."id",
    "vehicles"."rego" || ' ' || to_char("files"."created_at" AT TIME ZONE "operators"."timezone", 'YYYY-MM-DD') AS prefix,
    row_number() OVER (
      PARTITION BY "files"."vehicle_id", to_char("files"."created_at" AT TIME ZONE "operators"."timezone", 'YYYY-MM-DD')
      ORDER BY "files"."created_at", "files"."id"
    ) AS place
  FROM "files"
  JOIN "vehicles" ON "vehicles"."id" = "files"."vehicle_id"
  JOIN "operators" ON "operators"."id" = "files"."operator_id"
  WHERE "files"."purpose" = 'vehicle_photo' AND "files"."label" IS NULL
)
UPDATE "files" SET "label" = named.prefix || ' ' || lpad(named.place::text, 3, '0')
FROM named WHERE "files"."id" = named."id";--> statement-breakpoint
ALTER TABLE "operators" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vehicles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "files_one_photo_name_per_car" ON "files" USING btree ("operator_id","vehicle_id","label") WHERE "files"."purpose" = 'vehicle_photo';--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_vehicle_purposes" CHECK (("files"."purpose"::text in ('vehicle_photo', 'vehicle_photo_thumbnail', 'vehicle_document')) = ("files"."vehicle_id" is not null)
        and ("files"."purpose"::text = 'vehicle_photo_thumbnail') = ("files"."thumbnail_of_file_id" is not null)
        and ("files"."purpose"::text in ('vehicle_photo', 'vehicle_document')) = ("files"."label" is not null));