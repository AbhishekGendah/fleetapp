import { sql } from "drizzle-orm";
import { integer, jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { operators } from "./operators";

/**
 * Every Operator setting that is not a business detail, as one document
 * checked by `operatorSettingsSchema` in packages/core.
 *
 * One row per Operator, keyed by `operator_id`, and made empty at version 0
 * the first time settings are saved, so the save can lock it: an Operator
 * with no row, or an empty one, is on every default. `settings` holds only
 * what the Operator has changed. `version` goes up by one on each save that
 * changes something, so a rental can record which settings it was created
 * under (rule 14), and two saves at once cannot silently overwrite each other.
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
