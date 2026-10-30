CREATE TABLE "vehicle_makes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"hidden_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"make_id" uuid NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"hidden_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_activity_log" ADD COLUMN "entity_type" text;--> statement-breakpoint
ALTER TABLE "admin_activity_log" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
ALTER TABLE "admin_activity_log" ADD COLUMN "values_before" jsonb;--> statement-breakpoint
ALTER TABLE "admin_activity_log" ADD COLUMN "values_after" jsonb;--> statement-breakpoint
ALTER TABLE "vehicle_models" ADD CONSTRAINT "vehicle_models_make_id_vehicle_makes_id_fk" FOREIGN KEY ("make_id") REFERENCES "public"."vehicle_makes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_makes_name_unique" ON "vehicle_makes" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_models_name_unique" ON "vehicle_models" USING btree ("make_id",lower("name"));--> statement-breakpoint
CREATE INDEX "vehicle_models_make_idx" ON "vehicle_models" USING btree ("make_id");--> statement-breakpoint
-- The starting list: what was built into the app until now. Seeded before
-- row-level security is switched on, while the owner can still write.
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Abarth', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('500', '{}'::text[]),
  ('595', '{}'::text[]),
  ('695', '{}'::text[]),
  ('124 Spider', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Abarth';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Alfa Romeo', ARRAY['Alfa']::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Giulia', '{}'::text[]),
  ('Giulietta', '{}'::text[]),
  ('MiTo', '{}'::text[]),
  ('Stelvio', '{}'::text[]),
  ('Tonale', '{}'::text[]),
  ('4C', '{}'::text[]),
  ('159', '{}'::text[]),
  ('Brera', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Alfa Romeo';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Aston Martin', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('DB11', '{}'::text[]),
  ('DB12', '{}'::text[]),
  ('DBX', '{}'::text[]),
  ('Vantage', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Aston Martin';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Audi', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('A1', '{}'::text[]),
  ('A3', '{}'::text[]),
  ('A4', '{}'::text[]),
  ('A5', '{}'::text[]),
  ('A6', '{}'::text[]),
  ('A7', '{}'::text[]),
  ('A8', '{}'::text[]),
  ('e-tron', '{}'::text[]),
  ('e-tron GT', '{}'::text[]),
  ('Q2', '{}'::text[]),
  ('Q3', '{}'::text[]),
  ('Q4 e-tron', '{}'::text[]),
  ('Q5', '{}'::text[]),
  ('Q6 e-tron', '{}'::text[]),
  ('Q7', '{}'::text[]),
  ('Q8', '{}'::text[]),
  ('RS 3', '{}'::text[]),
  ('RS 4', '{}'::text[]),
  ('RS 6', '{}'::text[]),
  ('S3', '{}'::text[]),
  ('SQ5', '{}'::text[]),
  ('TT', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Audi';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Bentley', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Bentayga', '{}'::text[]),
  ('Continental GT', '{}'::text[]),
  ('Flying Spur', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Bentley';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('BMW', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('1 Series', '{}'::text[]),
  ('2 Series', '{}'::text[]),
  ('3 Series', '{}'::text[]),
  ('4 Series', '{}'::text[]),
  ('5 Series', '{}'::text[]),
  ('7 Series', '{}'::text[]),
  ('8 Series', '{}'::text[]),
  ('i3', '{}'::text[]),
  ('i4', '{}'::text[]),
  ('i5', '{}'::text[]),
  ('i7', '{}'::text[]),
  ('iX', '{}'::text[]),
  ('iX1', '{}'::text[]),
  ('iX3', '{}'::text[]),
  ('M2', '{}'::text[]),
  ('M3', '{}'::text[]),
  ('M4', '{}'::text[]),
  ('M5', '{}'::text[]),
  ('X1', '{}'::text[]),
  ('X2', '{}'::text[]),
  ('X3', '{}'::text[]),
  ('X4', '{}'::text[]),
  ('X5', '{}'::text[]),
  ('X6', '{}'::text[]),
  ('X7', '{}'::text[]),
  ('Z4', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'BMW';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('BYD', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Atto 1', '{}'::text[]),
  ('Atto 2', '{}'::text[]),
  ('Atto 3', '{}'::text[]),
  ('Dolphin', '{}'::text[]),
  ('Seal', '{}'::text[]),
  ('Sealion 6', '{}'::text[]),
  ('Sealion 7', '{}'::text[]),
  ('Shark 6', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'BYD';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Chery', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Omoda 5', '{}'::text[]),
  ('Omoda E5', '{}'::text[]),
  ('Tiggo 4', '{}'::text[]),
  ('Tiggo 4 Pro', '{}'::text[]),
  ('Tiggo 7 Pro', '{}'::text[]),
  ('Tiggo 8 Pro', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Chery';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Chevrolet', ARRAY['Chevy']::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Corvette', '{}'::text[]),
  ('Silverado', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Chevrolet';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Chrysler', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('300', '{}'::text[]),
  ('Grand Voyager', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Chrysler';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Citroen', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Berlingo', '{}'::text[]),
  ('C3', '{}'::text[]),
  ('C3 Aircross', '{}'::text[]),
  ('C4', '{}'::text[]),
  ('C5 Aircross', '{}'::text[]),
  ('C5 X', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Citroen';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Cupra', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Ateca', '{}'::text[]),
  ('Born', '{}'::text[]),
  ('Formentor', '{}'::text[]),
  ('Leon', '{}'::text[]),
  ('Tavascan', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Cupra';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Deepal', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('E07', '{}'::text[]),
  ('S05', '{}'::text[]),
  ('S07', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Deepal';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Dodge', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Journey', '{}'::text[]),
  ('Nitro', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Dodge';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Fiat', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('500', '{}'::text[]),
  ('500X', '{}'::text[]),
  ('Doblo', '{}'::text[]),
  ('Ducato', '{}'::text[]),
  ('Freemont', '{}'::text[]),
  ('Panda', '{}'::text[]),
  ('Punto', '{}'::text[]),
  ('Scudo', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Fiat';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Ford', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Bronco', '{}'::text[]),
  ('EcoSport', '{}'::text[]),
  ('Endura', '{}'::text[]),
  ('Escape', '{}'::text[]),
  ('Everest', '{}'::text[]),
  ('Falcon', '{}'::text[]),
  ('Fiesta', '{}'::text[]),
  ('Focus', '{}'::text[]),
  ('Kuga', '{}'::text[]),
  ('Mondeo', '{}'::text[]),
  ('Mustang', '{}'::text[]),
  ('Mustang Mach-E', '{}'::text[]),
  ('Puma', '{}'::text[]),
  ('Ranger', '{}'::text[]),
  ('Territory', '{}'::text[]),
  ('Transit', '{}'::text[]),
  ('Transit Custom', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Ford';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Genesis', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('G70', '{}'::text[]),
  ('G80', '{}'::text[]),
  ('G90', '{}'::text[]),
  ('GV60', '{}'::text[]),
  ('GV70', '{}'::text[]),
  ('GV80', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Genesis';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('GWM', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Cannon', '{}'::text[]),
  ('Cannon Alpha', '{}'::text[]),
  ('Ora', '{}'::text[]),
  ('Tank 300', '{}'::text[]),
  ('Tank 500', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'GWM';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Haval', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('H2', '{}'::text[]),
  ('H6', '{}'::text[]),
  ('H6 GT', '{}'::text[]),
  ('H9', '{}'::text[]),
  ('Jolion', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Haval';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Holden', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Acadia', '{}'::text[]),
  ('Astra', '{}'::text[]),
  ('Barina', '{}'::text[]),
  ('Captiva', '{}'::text[]),
  ('Colorado', '{}'::text[]),
  ('Commodore', '{}'::text[]),
  ('Cruze', '{}'::text[]),
  ('Equinox', '{}'::text[]),
  ('Malibu', '{}'::text[]),
  ('Spark', '{}'::text[]),
  ('Trailblazer', '{}'::text[]),
  ('Trax', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Holden';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Honda', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Accord', '{}'::text[]),
  ('City', '{}'::text[]),
  ('Civic', '{}'::text[]),
  ('CR-V', '{}'::text[]),
  ('e:Ny1', '{}'::text[]),
  ('HR-V', '{}'::text[]),
  ('Insight', '{}'::text[]),
  ('Jazz', '{}'::text[]),
  ('Odyssey', '{}'::text[]),
  ('ZR-V', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Honda';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Hyundai', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Accent', '{}'::text[]),
  ('Elantra', '{}'::text[]),
  ('i20', '{}'::text[]),
  ('i30', '{}'::text[]),
  ('i40', '{}'::text[]),
  ('iLoad', '{}'::text[]),
  ('iMax', '{}'::text[]),
  ('Inster', '{}'::text[]),
  ('Ioniq', '{}'::text[]),
  ('Ioniq 5', '{}'::text[]),
  ('Ioniq 6', '{}'::text[]),
  ('Kona', '{}'::text[]),
  ('Palisade', '{}'::text[]),
  ('Santa Fe', '{}'::text[]),
  ('Staria', '{}'::text[]),
  ('Tucson', '{}'::text[]),
  ('Venue', '{}'::text[]),
  ('Veloster', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Hyundai';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Ineos', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Grenadier', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Ineos';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Isuzu', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('D-Max', '{}'::text[]),
  ('MU-X', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Isuzu';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Jaguar', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('E-Pace', '{}'::text[]),
  ('F-Pace', '{}'::text[]),
  ('F-Type', '{}'::text[]),
  ('I-Pace', '{}'::text[]),
  ('XE', '{}'::text[]),
  ('XF', '{}'::text[]),
  ('XJ', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Jaguar';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Jeep', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Avenger', '{}'::text[]),
  ('Cherokee', '{}'::text[]),
  ('Compass', '{}'::text[]),
  ('Gladiator', '{}'::text[]),
  ('Grand Cherokee', '{}'::text[]),
  ('Renegade', '{}'::text[]),
  ('Wrangler', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Jeep';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('KGM', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Actyon', '{}'::text[]),
  ('Korando', '{}'::text[]),
  ('Musso', '{}'::text[]),
  ('Rexton', '{}'::text[]),
  ('Tivoli', '{}'::text[]),
  ('Torres', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'KGM';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Kia', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Carnival', '{}'::text[]),
  ('Cerato', '{}'::text[]),
  ('EV3', '{}'::text[]),
  ('EV5', '{}'::text[]),
  ('EV6', '{}'::text[]),
  ('EV9', '{}'::text[]),
  ('K4', '{}'::text[]),
  ('Niro', '{}'::text[]),
  ('Optima', '{}'::text[]),
  ('Picanto', '{}'::text[]),
  ('Rio', '{}'::text[]),
  ('Seltos', '{}'::text[]),
  ('Sorento', '{}'::text[]),
  ('Soul', '{}'::text[]),
  ('Sportage', '{}'::text[]),
  ('Stinger', '{}'::text[]),
  ('Stonic', '{}'::text[]),
  ('Tasman', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Kia';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Lamborghini', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Huracan', '{}'::text[]),
  ('Revuelto', '{}'::text[]),
  ('Urus', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Lamborghini';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Land Rover', ARRAY['Landrover']::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Defender', '{}'::text[]),
  ('Discovery', '{}'::text[]),
  ('Discovery Sport', '{}'::text[]),
  ('Range Rover', '{}'::text[]),
  ('Range Rover Evoque', '{}'::text[]),
  ('Range Rover Sport', '{}'::text[]),
  ('Range Rover Velar', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Land Rover';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('LDV', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('D90', '{}'::text[]),
  ('Deliver 9', '{}'::text[]),
  ('eT60', '{}'::text[]),
  ('G10', '{}'::text[]),
  ('MIFA 9', '{}'::text[]),
  ('T60', '{}'::text[]),
  ('Terron 9', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'LDV';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Leapmotor', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('B10', '{}'::text[]),
  ('C10', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Leapmotor';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Lexus', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('CT', '{}'::text[]),
  ('ES', '{}'::text[]),
  ('GS', '{}'::text[]),
  ('IS', '{}'::text[]),
  ('LBX', '{}'::text[]),
  ('LC', '{}'::text[]),
  ('LM', '{}'::text[]),
  ('LS', '{}'::text[]),
  ('LX', '{}'::text[]),
  ('NX', '{}'::text[]),
  ('RC', '{}'::text[]),
  ('RX', '{}'::text[]),
  ('RZ', '{}'::text[]),
  ('UX', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Lexus';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Mahindra', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Pik-Up', '{}'::text[]),
  ('Scorpio', '{}'::text[]),
  ('XUV300', '{}'::text[]),
  ('XUV3XO', '{}'::text[]),
  ('XUV700', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Mahindra';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Maserati', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Ghibli', '{}'::text[]),
  ('Grecale', '{}'::text[]),
  ('Levante', '{}'::text[]),
  ('Quattroporte', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Maserati';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Mazda', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('BT-50', '{}'::text[]),
  ('CX-3', '{}'::text[]),
  ('CX-30', '{}'::text[]),
  ('CX-5', '{}'::text[]),
  ('CX-60', '{}'::text[]),
  ('CX-70', '{}'::text[]),
  ('CX-8', '{}'::text[]),
  ('CX-80', '{}'::text[]),
  ('CX-9', '{}'::text[]),
  ('CX-90', '{}'::text[]),
  ('Mazda2', ARRAY['2']::text[]),
  ('Mazda3', ARRAY['3']::text[]),
  ('Mazda6', ARRAY['6']::text[]),
  ('MX-30', '{}'::text[]),
  ('MX-5', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Mazda';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('McLaren', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('720S', '{}'::text[]),
  ('750S', '{}'::text[]),
  ('Artura', '{}'::text[]),
  ('GT', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'McLaren';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Mercedes-Benz', ARRAY['Mercedes', 'Merc', 'Benz']::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('A-Class', '{}'::text[]),
  ('AMG GT', '{}'::text[]),
  ('B-Class', '{}'::text[]),
  ('C-Class', '{}'::text[]),
  ('CLA', '{}'::text[]),
  ('CLS', '{}'::text[]),
  ('E-Class', '{}'::text[]),
  ('EQA', '{}'::text[]),
  ('EQB', '{}'::text[]),
  ('EQC', '{}'::text[]),
  ('EQE', '{}'::text[]),
  ('EQS', '{}'::text[]),
  ('G-Class', '{}'::text[]),
  ('GLA', '{}'::text[]),
  ('GLB', '{}'::text[]),
  ('GLC', '{}'::text[]),
  ('GLE', '{}'::text[]),
  ('GLS', '{}'::text[]),
  ('S-Class', '{}'::text[]),
  ('Sprinter', '{}'::text[]),
  ('Vito', '{}'::text[]),
  ('X-Class', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Mercedes-Benz';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('MG', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Cyberster', '{}'::text[]),
  ('HS', '{}'::text[]),
  ('MG3', '{}'::text[]),
  ('MG4', '{}'::text[]),
  ('MG5', '{}'::text[]),
  ('MG6', '{}'::text[]),
  ('S5', '{}'::text[]),
  ('U9', '{}'::text[]),
  ('ZS', '{}'::text[]),
  ('ZS EV', '{}'::text[]),
  ('ZST', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'MG';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Mini', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Clubman', '{}'::text[]),
  ('Cooper', '{}'::text[]),
  ('Countryman', '{}'::text[]),
  ('Aceman', '{}'::text[]),
  ('Paceman', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Mini';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Mitsubishi', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('ASX', '{}'::text[]),
  ('Eclipse Cross', '{}'::text[]),
  ('Express', '{}'::text[]),
  ('Lancer', '{}'::text[]),
  ('Mirage', '{}'::text[]),
  ('Outlander', '{}'::text[]),
  ('Pajero', '{}'::text[]),
  ('Pajero Sport', '{}'::text[]),
  ('Triton', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Mitsubishi';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Nissan', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('370Z', '{}'::text[]),
  ('Ariya', '{}'::text[]),
  ('Dualis', '{}'::text[]),
  ('Juke', '{}'::text[]),
  ('Leaf', '{}'::text[]),
  ('Navara', '{}'::text[]),
  ('Pathfinder', '{}'::text[]),
  ('Patrol', '{}'::text[]),
  ('Pulsar', '{}'::text[]),
  ('Qashqai', '{}'::text[]),
  ('X-Trail', '{}'::text[]),
  ('Z', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Nissan';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Peugeot', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('2008', '{}'::text[]),
  ('208', '{}'::text[]),
  ('3008', '{}'::text[]),
  ('308', '{}'::text[]),
  ('408', '{}'::text[]),
  ('5008', '{}'::text[]),
  ('508', '{}'::text[]),
  ('Expert', '{}'::text[]),
  ('Partner', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Peugeot';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Polestar', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Polestar 2', '{}'::text[]),
  ('Polestar 3', '{}'::text[]),
  ('Polestar 4', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Polestar';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Porsche', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('911', '{}'::text[]),
  ('Boxster', '{}'::text[]),
  ('Cayenne', '{}'::text[]),
  ('Cayman', '{}'::text[]),
  ('Macan', '{}'::text[]),
  ('Panamera', '{}'::text[]),
  ('Taycan', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Porsche';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Proton', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Exora', '{}'::text[]),
  ('Persona', '{}'::text[]),
  ('Preve', '{}'::text[]),
  ('S16', '{}'::text[]),
  ('Suprima S', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Proton';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Ram', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('1500', '{}'::text[]),
  ('2500', '{}'::text[]),
  ('3500', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Ram';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Renault', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Arkana', '{}'::text[]),
  ('Captur', '{}'::text[]),
  ('Clio', '{}'::text[]),
  ('Kadjar', '{}'::text[]),
  ('Kangoo', '{}'::text[]),
  ('Koleos', '{}'::text[]),
  ('Master', '{}'::text[]),
  ('Megane', '{}'::text[]),
  ('Trafic', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Renault';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Rolls-Royce', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Cullinan', '{}'::text[]),
  ('Ghost', '{}'::text[]),
  ('Phantom', '{}'::text[]),
  ('Spectre', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Rolls-Royce';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Skoda', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Elroq', '{}'::text[]),
  ('Enyaq', '{}'::text[]),
  ('Fabia', '{}'::text[]),
  ('Kamiq', '{}'::text[]),
  ('Karoq', '{}'::text[]),
  ('Kodiaq', '{}'::text[]),
  ('Octavia', '{}'::text[]),
  ('Rapid', '{}'::text[]),
  ('Scala', '{}'::text[]),
  ('Superb', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Skoda';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Smart', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('#1', '{}'::text[]),
  ('#3', '{}'::text[]),
  ('Fortwo', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Smart';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('SsangYong', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Actyon', '{}'::text[]),
  ('Korando', '{}'::text[]),
  ('Musso', '{}'::text[]),
  ('Rexton', '{}'::text[]),
  ('Stavic', '{}'::text[]),
  ('Tivoli', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'SsangYong';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Subaru', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('BRZ', '{}'::text[]),
  ('Crosstrek', '{}'::text[]),
  ('Forester', '{}'::text[]),
  ('Impreza', '{}'::text[]),
  ('Liberty', '{}'::text[]),
  ('Outback', '{}'::text[]),
  ('Solterra', '{}'::text[]),
  ('WRX', '{}'::text[]),
  ('XV', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Subaru';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Suzuki', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Alto', '{}'::text[]),
  ('Baleno', '{}'::text[]),
  ('Celerio', '{}'::text[]),
  ('Grand Vitara', '{}'::text[]),
  ('Ignis', '{}'::text[]),
  ('Jimny', '{}'::text[]),
  ('Kizashi', '{}'::text[]),
  ('S-Cross', '{}'::text[]),
  ('Swift', '{}'::text[]),
  ('Vitara', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Suzuki';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Tesla', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Model 3', ARRAY['M3']::text[]),
  ('Model S', '{}'::text[]),
  ('Model X', '{}'::text[]),
  ('Model Y', ARRAY['MY']::text[]),
  ('Cybertruck', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Tesla';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Toyota', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('86', '{}'::text[]),
  ('Aurion', '{}'::text[]),
  ('bZ4X', '{}'::text[]),
  ('C-HR', '{}'::text[]),
  ('Camry', '{}'::text[]),
  ('Corolla', '{}'::text[]),
  ('Corolla Cross', '{}'::text[]),
  ('Fortuner', '{}'::text[]),
  ('GR86', '{}'::text[]),
  ('GR Yaris', '{}'::text[]),
  ('HiAce', ARRAY['Commuter']::text[]),
  ('HiLux', '{}'::text[]),
  ('Kluger', '{}'::text[]),
  ('LandCruiser', ARRAY['Cruiser']::text[]),
  ('LandCruiser Prado', ARRAY['Prado']::text[]),
  ('Prius', '{}'::text[]),
  ('Prius c', '{}'::text[]),
  ('Prius v', '{}'::text[]),
  ('RAV4', '{}'::text[]),
  ('Rukus', '{}'::text[]),
  ('Supra', '{}'::text[]),
  ('Tarago', '{}'::text[]),
  ('Yaris', '{}'::text[]),
  ('Yaris Cross', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Toyota';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Volkswagen', ARRAY['VW']::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('Amarok', '{}'::text[]),
  ('Arteon', '{}'::text[]),
  ('Caddy', '{}'::text[]),
  ('Crafter', '{}'::text[]),
  ('Golf', '{}'::text[]),
  ('ID.4', '{}'::text[]),
  ('ID.5', '{}'::text[]),
  ('ID. Buzz', '{}'::text[]),
  ('Jetta', '{}'::text[]),
  ('Multivan', '{}'::text[]),
  ('Passat', '{}'::text[]),
  ('Polo', '{}'::text[]),
  ('T-Cross', '{}'::text[]),
  ('T-Roc', '{}'::text[]),
  ('Tiguan', '{}'::text[]),
  ('Touareg', '{}'::text[]),
  ('Transporter', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Volkswagen';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Volvo', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('C40', '{}'::text[]),
  ('EX30', '{}'::text[]),
  ('EX40', '{}'::text[]),
  ('EX90', '{}'::text[]),
  ('S60', '{}'::text[]),
  ('S90', '{}'::text[]),
  ('V40', '{}'::text[]),
  ('V60', '{}'::text[]),
  ('V90', '{}'::text[]),
  ('XC40', '{}'::text[]),
  ('XC60', '{}'::text[]),
  ('XC90', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Volvo';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Xpeng', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('G6', '{}'::text[]),
  ('G9', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Xpeng';--> statement-breakpoint
INSERT INTO "vehicle_makes" ("name", "aliases") VALUES ('Zeekr', '{}'::text[]);--> statement-breakpoint
INSERT INTO "vehicle_models" ("make_id", "name", "aliases")
SELECT "vehicle_makes"."id", "seed"."name", "seed"."aliases" FROM "vehicle_makes",
  (VALUES ('001', '{}'::text[]),
  ('7X', '{}'::text[]),
  ('X', '{}'::text[])) AS "seed" ("name", "aliases")
WHERE "vehicle_makes"."name" = 'Zeekr';--> statement-breakpoint
-- The list belongs to AGS. The admin app keeps it; the Operator app only
-- reads it, to suggest makes and models. Nobody deletes a row: an entry is
-- hidden, so it can be shown again.
ALTER TABLE "vehicle_makes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vehicle_makes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vehicle_models" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "vehicle_models" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT ON "vehicle_makes", "vehicle_models" TO "admin_app_role";--> statement-breakpoint
GRANT UPDATE ("name", "aliases", "hidden_at", "updated_at") ON "vehicle_makes", "vehicle_models" TO "admin_app_role";--> statement-breakpoint
GRANT SELECT ON "vehicle_makes", "vehicle_models" TO "web_app_role";--> statement-breakpoint
CREATE POLICY "vehicle_makes_admin" ON "vehicle_makes" FOR ALL TO "admin_app_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "vehicle_models_admin" ON "vehicle_models" FOR ALL TO "admin_app_role" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "vehicle_makes_web_read" ON "vehicle_makes" FOR SELECT TO "web_app_role" USING (true);--> statement-breakpoint
CREATE POLICY "vehicle_models_web_read" ON "vehicle_models" FOR SELECT TO "web_app_role" USING (true);--> statement-breakpoint
-- The admin site's "Typed by Operators" list and its "Fix this car" button.
-- The admin app has no access to cars (rule 5), so these two functions are
-- its only way in, and they do exactly this much: list cars whose make or
-- model is not in the list (which car, whose, and the two words), and change
-- one car's make and model, logging it in that Operator's history as an
-- Admin's change. They run as the migration owner (SECURITY DEFINER), which
-- gets just the policies they need; the owner owns these tables and could
-- switch row-level security off anyway, so nothing new is exposed.
DO $$
BEGIN
  EXECUTE format('CREATE POLICY "vehicles_owner_catalogue_read" ON "vehicles" FOR SELECT TO %I USING (true)', current_user);
  EXECUTE format('CREATE POLICY "vehicles_owner_catalogue_fix" ON "vehicles" FOR UPDATE TO %I USING (true) WITH CHECK (true)', current_user);
  EXECUTE format('CREATE POLICY "activity_log_owner_catalogue_fix" ON "activity_log" FOR INSERT TO %I WITH CHECK (true)', current_user);
  EXECUTE format('CREATE POLICY "vehicle_makes_owner_read" ON "vehicle_makes" FOR SELECT TO %I USING (true)', current_user);
  EXECUTE format('CREATE POLICY "vehicle_models_owner_read" ON "vehicle_models" FOR SELECT TO %I USING (true)', current_user);
END
$$;--> statement-breakpoint
CREATE FUNCTION "app"."vehicles_not_in_catalogue"()
RETURNS TABLE ("vehicle_id" uuid, "operator_id" uuid, "make" text, "model" text, "created_at" timestamp with time zone)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT "v"."id", "v"."operator_id", "v"."make", "v"."model", "v"."created_at"
  FROM "public"."vehicles" "v"
  WHERE "v"."archived_at" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "public"."vehicle_models" "mo"
      JOIN "public"."vehicle_makes" "ma" ON "ma"."id" = "mo"."make_id"
      WHERE "ma"."name" = "v"."make" AND "mo"."name" = "v"."model"
        AND "ma"."hidden_at" IS NULL AND "mo"."hidden_at" IS NULL
    )
  ORDER BY "v"."created_at" DESC
$$;--> statement-breakpoint
CREATE FUNCTION "app"."correct_vehicle_make_model"(
  "target_vehicle_id" uuid,
  "new_make" text,
  "new_model" text,
  "admin_user_id" uuid
) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  "car" record;
BEGIN
  IF "new_make" IS NULL OR "new_model" IS NULL
     OR length(btrim("new_make")) NOT BETWEEN 1 AND 200
     OR length(btrim("new_model")) NOT BETWEEN 1 AND 200
     OR "new_make" ~ '[[:cntrl:]]' OR "new_model" ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'A make and model of 1 to 200 characters on one line are required.'
      USING ERRCODE = '22023';
  END IF;
  SELECT "id", "operator_id", "make", "model" INTO "car"
  FROM "public"."vehicles" WHERE "id" = "target_vehicle_id" FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF "car"."make" = btrim("new_make") AND "car"."model" = btrim("new_model") THEN
    RETURN true;
  END IF;
  UPDATE "public"."vehicles"
  SET "make" = btrim("new_make"), "model" = btrim("new_model"), "updated_at" = now()
  WHERE "id" = "car"."id";
  INSERT INTO "public"."activity_log"
    ("operator_id", "actor_type", "actor_id", "entity_type", "entity_id", "action", "values_before", "values_after")
  VALUES (
    "car"."operator_id", 'admin', "admin_user_id", 'vehicle', "car"."id", 'updated',
    jsonb_build_object('make', "car"."make", 'model', "car"."model"),
    jsonb_build_object('make', btrim("new_make"), 'model', btrim("new_model"))
  );
  RETURN true;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."vehicles_not_in_catalogue"() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."correct_vehicle_make_model"(uuid, text, text, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."vehicles_not_in_catalogue"() TO "admin_app_role";--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."correct_vehicle_make_model"(uuid, text, text, uuid) TO "admin_app_role";
