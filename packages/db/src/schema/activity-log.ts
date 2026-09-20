import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { primaryKeyColumn } from "./columns";
import { actorTypeEnum } from "./enums";
import { operatorIdColumn } from "./operators";

/**
 * Append-only record of every create, update, archive and privileged read.
 * See rule 19 in CLAUDE.md.
 *
 * Deliberately has no `updated_at` or `archived_at`: a row here is never
 * changed. Updates and deletes are blocked by a database trigger as well as by
 * withheld grants, so even a mistake in application code cannot rewrite
 * history.
 *
 * `entityType` and `entityId` are a loose reference rather than a foreign key.
 * A log row must outlive the record it describes, and a foreign key would
 * either block archival or cascade the history away.
 */
export const activityLog = pgTable(
  "activity_log",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,

    actorType: actorTypeEnum("actor_type").notNull(),

    /** Null for `system` actions, which have no acting person. */
    actorId: uuid("actor_id"),

    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),

    /** Field values before and after the change. Null on create and on reads. */
    valuesBefore: jsonb("values_before"),
    valuesAfter: jsonb("values_after"),

    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Backs the history tab on each record: one entity's log, newest first.
    index("activity_log_entity_idx").on(
      table.operatorId,
      table.entityType,
      table.entityId,
      table.occurredAt.desc(),
    ),
    index("activity_log_operator_occurred_at_idx").on(table.operatorId, table.occurredAt.desc()),
  ],
);
