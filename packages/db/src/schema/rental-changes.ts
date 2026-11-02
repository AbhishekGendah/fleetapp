import { RENTAL_CHANGE_KINDS, RENTAL_CHANGE_STATUSES } from "@fleetapp/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { primaryKeyColumn } from "./columns";
import { operatorIdColumn } from "./operators";
import { rentalLink, rentalTypeEnum } from "./rentals";
import { users } from "./users";

export const rentalChangeKindEnum = pgEnum("rental_change_kind", RENTAL_CHANGE_KINDS);
export const rentalChangeStatusEnum = pgEnum("rental_change_status", RENTAL_CHANGE_STATUSES);

/**
 * One change of terms during a rental (docs/plans/phase-3-slice-7.md, rule
 * 14): a new end, made ongoing, or a new weekly rate, with what it was
 * before. Kept for good: only its status moves on (waiting to applied or
 * withdrawn) and its signed form is added once, as the migration's trigger
 * enforces. A rate change counts only once the Renter has signed it.
 */
export const rentalChanges = pgTable(
  "rental_changes",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    rentalId: uuid("rental_id").notNull(),
    kind: rentalChangeKindEnum("kind").notNull(),
    status: rentalChangeStatusEnum("status").notNull(),
    /** End and kind before and after, for end_date and make_ongoing. */
    typeBefore: rentalTypeEnum("type_before"),
    typeAfter: rentalTypeEnum("type_after"),
    endBefore: timestamp("end_before", { withTimezone: true }),
    endAfter: timestamp("end_after", { withTimezone: true }),
    /** Given an end with less notice than the rental's settings ask for (agreed, and logged). */
    isShortNotice: boolean("is_short_notice").notNull().default(false),
    /** The rate before and after, and the day the new one applies from, for weekly_rate. */
    rateBeforeCents: integer("rate_before_cents"),
    rateAfterCents: integer("rate_after_cents"),
    appliesFrom: date("applies_from"),
    reason: text("reason").notNull(),
    /**
     * The signed change-of-terms form, once signed. Its link to
     * issued_documents is in the migration's own SQL: declared here it would
     * loop the table types (files, links, changes, documents).
     */
    documentId: uuid("document_id"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  },
  (table) => [
    rentalLink("rental_changes", table),
    unique("rental_changes_id_operator_unique").on(table.id, table.operatorId),
    unique("rental_changes_document_unique").on(table.documentId),
    index("rental_changes_rental_idx").on(table.operatorId, table.rentalId, table.createdAt),
    // One rate change waiting at a time: withdraw it before making another.
    uniqueIndex("rental_changes_one_rate_waiting")
      .on(table.operatorId, table.rentalId)
      .where(sql`${table.kind} = 'weekly_rate' and ${table.status} = 'waiting_for_signature'`),
    check(
      "rental_changes_end_values",
      sql`(${table.kind} = 'weekly_rate') = (${table.typeAfter} is null)
        and (${table.kind} <> 'end_date' or (${table.endAfter} is not null and ${table.typeAfter} = 'fixed_term'))
        and (${table.kind} <> 'make_ongoing' or (${table.endAfter} is null and ${table.typeAfter} = 'ongoing'))`,
    ),
    check(
      "rental_changes_rate_values",
      sql`(${table.kind} = 'weekly_rate') = (${table.rateAfterCents} is not null)
        and (${table.rateAfterCents} is null or (${table.rateAfterCents} > 0
          and ${table.rateBeforeCents} > 0 and ${table.appliesFrom} is not null))`,
    ),
    check(
      "rental_changes_status_times",
      sql`(${table.status} = 'applied') = (${table.appliedAt} is not null)
        and (${table.status} = 'withdrawn') = (${table.withdrawnAt} is not null)
        and (${table.kind} <> 'weekly_rate' or ${table.status} <> 'applied' or ${table.documentId} is not null)`,
    ),
    check("rental_changes_reason", sql`length(trim(${table.reason})) > 0`),
  ],
);
