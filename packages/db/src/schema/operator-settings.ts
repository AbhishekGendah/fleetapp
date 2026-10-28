import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { operators } from "./operators";

/**
 * Every Operator setting that is not a business detail, as one document
 * checked by `operatorSettingsSchema` in packages/core.
 *
 * One row per Operator, keyed by `operator_id`, and created on the first
 * save: an Operator with no row is on every default. `settings` holds only
 * what the Operator has changed. `version` goes up by one on each save, so a
 * rental can record which settings it was created under (rule 14), and two
 * saves at once cannot silently overwrite each other.
 */
export const operatorSettings = pgTable("operator_settings", {
  operatorId: uuid("operator_id")
    .primaryKey()
    .references(() => operators.id),

  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  version: integer("version").notNull().default(1),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});
