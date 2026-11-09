import {
  DEBIT_COLLECTION_PLANS,
  MAXIMUM_SPLIT_WEEKS,
  MINIMUM_SPLIT_WEEKS,
  PAYMENT_LINE_REASONS,
} from "@fleetapp/core";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  foreignKey,
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

import { primaryKeyColumn, timestampColumns } from "./columns";
import { ledgerLines } from "./ledger";
import { operatorIdColumn } from "./operators";
import { payments } from "./payments";
import { rentalLink } from "./rentals";
import { users } from "./users";

export const debitCollectionPlanEnum = pgEnum("debit_collection_plan", DEBIT_COLLECTION_PLANS);
export const paymentLineReasonEnum = pgEnum("payment_line_reason", PAYMENT_LINE_REASONS);

/** A link from a row to a ledger line of the same rental (and business). */
function ledgerLineLink(
  name: string,
  table: { ledgerLineId: AnyPgColumn; operatorId: AnyPgColumn; rentalId: AnyPgColumn },
) {
  return foreignKey({
    name: `${name}_ledger_line_fk`,
    columns: [table.ledgerLineId, table.operatorId, table.rentalId],
    foreignColumns: [ledgerLines.id, ledgerLines.operatorId, ledgerLines.rentalId],
  });
}

/** A link from a row to a payment of the same rental (and business). */
function paymentLink(
  name: string,
  table: { paymentId: AnyPgColumn; operatorId: AnyPgColumn; rentalId: AnyPgColumn },
) {
  return foreignKey({
    name: `${name}_payment_fk`,
    columns: [table.paymentId, table.operatorId, table.rentalId],
    foreignColumns: [payments.id, payments.operatorId, payments.rentalId],
  });
}

/**
 * How a one-off charge is collected when the Renter pays by direct debit
 * (docs/plans/phase-4-slice-5.md): invoice only (the default), with the
 * next weekly debit, on its own now, or split over 2 to 12 weekly debits.
 * One per charge; the database refuses a change once any part is in a debit.
 */
export const debitPlans = pgTable(
  "debit_plans",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    rentalId: uuid("rental_id").notNull(),
    ledgerLineId: uuid("ledger_line_id").notNull().unique(),
    plan: debitCollectionPlanEnum("plan").notNull(),
    /** For a split: how many weekly debits. */
    weeks: integer("weeks"),
    chosenByUserId: uuid("chosen_by_user_id").references(() => users.id),
    ...timestampColumns,
  },
  (table) => [
    rentalLink("debit_plans", table),
    ledgerLineLink("debit_plans", table),
    index("debit_plans_rental_idx").on(table.operatorId, table.rentalId),
    check(
      "debit_plans_weeks",
      sql`(${table.plan} = 'split') = (${table.weeks} is not null)
        and (${table.weeks} is null or ${table.weeks} between ${sql.raw(String(MINIMUM_SPLIT_WEEKS))} and ${sql.raw(String(MAXIMUM_SPLIT_WEEKS))})`,
    ),
  ],
);

/**
 * What each debit was planned from: a rent week's charge, or a one-off
 * charge (or one instalment of a split). A part goes into one debit only,
 * whatever happens to it. Added to, never changed.
 */
export const debitItems = pgTable(
  "debit_items",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    rentalId: uuid("rental_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
    ledgerLineId: uuid("ledger_line_id").notNull(),
    /** 1 for rent and a whole charge; 1 to N for a split's instalments. */
    instalment: integer("instalment").notNull(),
    amountCents: integer("amount_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    rentalLink("debit_items", table),
    paymentLink("debit_items", table),
    ledgerLineLink("debit_items", table),
    unique("debit_items_one_per_part").on(table.ledgerLineId, table.instalment),
    index("debit_items_payment_idx").on(table.operatorId, table.paymentId),
    check("debit_items_instalment", sql`${table.instalment} >= 1`),
    check("debit_items_amount", sql`${table.amountCents} > 0`),
  ],
);

/**
 * Which ledger line came from which Stripe payment, and why: the payment
 * cleared, a refund, a refund that failed, or a dispute lost or won. Keeps
 * Stripe's IDs off the ledger. Each once (rule 20); added to, never changed.
 */
export const paymentLedgerLines = pgTable(
  "payment_ledger_lines",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    rentalId: uuid("rental_id").notNull(),
    paymentId: uuid("payment_id").notNull(),
    ledgerLineId: uuid("ledger_line_id").notNull().unique(),
    reason: paymentLineReasonEnum("reason").notNull(),
    /** Stripe's refund or dispute ID; none for the payment clearing. */
    stripeObjectId: text("stripe_object_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    rentalLink("payment_ledger_lines", table),
    paymentLink("payment_ledger_lines", table),
    ledgerLineLink("payment_ledger_lines", table),
    uniqueIndex("payment_ledger_lines_one_settled")
      .on(table.paymentId)
      .where(sql`${table.reason} = 'settled'`),
    unique("payment_ledger_lines_once_per_object").on(table.stripeObjectId, table.reason),
    index("payment_ledger_lines_payment_idx").on(table.operatorId, table.paymentId),
    check(
      "payment_ledger_lines_object",
      sql`(${table.reason} = 'settled') = (${table.stripeObjectId} is null)
        and (${table.stripeObjectId} is null or ${table.stripeObjectId} ~ '^[a-z]+_[A-Za-z0-9]+$')`,
    ),
  ],
);
