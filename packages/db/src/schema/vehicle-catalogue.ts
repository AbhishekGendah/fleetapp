import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { primaryKeyColumn, timestampColumns } from "./columns";

const catalogueColumns = {
  name: text("name").notNull(),
  /** Other names people type for it ("Merc", "Prado"), matched like the name itself. */
  aliases: text("aliases")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  /** Hidden from suggestions; kept, so it can be shown again (rule 13). */
  hiddenAt: timestamp("hidden_at", { withTimezone: true }),
  ...timestampColumns,
};

/**
 * The shared list of car makes every Operator's car form suggests from. It
 * belongs to AGS, not to any Operator: the admin site edits it, the Operator
 * app only reads it. Cars store the make as text, not a link here.
 */
export const vehicleMakes = pgTable(
  "vehicle_makes",
  { ...primaryKeyColumn, ...catalogueColumns },
  (table) => [uniqueIndex("vehicle_makes_name_unique").on(sql`lower(${table.name})`)],
);

/** The models listed under each make. */
export const vehicleModels = pgTable(
  "vehicle_models",
  {
    ...primaryKeyColumn,
    makeId: uuid("make_id")
      .notNull()
      .references(() => vehicleMakes.id),
    ...catalogueColumns,
  },
  (table) => [
    uniqueIndex("vehicle_models_name_unique").on(table.makeId, sql`lower(${table.name})`),
    index("vehicle_models_make_idx").on(table.makeId),
  ],
);
