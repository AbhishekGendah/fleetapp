import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Shared column builders. This module deliberately imports no tables, so the
 * tenancy column lives in `operators.ts` next to the table it points at rather
 * than here — that keeps the schema modules free of import cycles.
 */

export const primaryKeyColumn = {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
} as const;

/**
 * `archivedAt` backs rule 13: core records are archived, never hard-deleted.
 */
export const auditColumns = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`)
    .$onUpdate(() => new Date()),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
} as const;
