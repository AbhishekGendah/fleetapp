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
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  type PgTableExtraConfigValue,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { primaryKeyColumn, timestampColumns } from "./columns";
import { issuedDocuments } from "./contracts";
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
 * One per charge; the database refuses a change once any part is in a debit,
 * and a debit of any part outside its current notice's window.
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
    /**
     * The notice the Renter was last emailed for exactly this plan (its date
     * and how it is taken; docs/plans/one-off-charge-notice.md). None until
     * then, and a plan with none is never debited. The database voids it on
     * any change of plan or weeks (migration 0064); a new email gives a new one.
     */
    noticeId: uuid("notice_id"),
    /**
     * Emails the nightly notice run sent for this plan since its last change,
     * its last notice or the business's last Email again: the run stops at
     * AUTOMATIC_NOTICE_LIMIT and the charge asks the business instead.
     */
    automaticNoticeCount: integer("automatic_notice_count").notNull().default(0),
    ...timestampColumns,
  },
  // Typed by hand: the plan and its notices link to each other.
  (table): PgTableExtraConfigValue[] => [
    unique("debit_plans_id_operator_unique").on(table.id, table.operatorId),
    foreignKey({
      name: "debit_plans_notice_fk",
      columns: [table.noticeId, table.operatorId, table.id],
      foreignColumns: [debitNotices.id, debitNotices.operatorId, debitNotices.debitPlanId],
    }),
    rentalLink("debit_plans", table),
    ledgerLineLink("debit_plans", table),
    index("debit_plans_rental_idx").on(table.operatorId, table.rentalId),
    check("debit_plans_automatic_notices", sql`${table.automaticNoticeCount} >= 0`),
    check(
      "debit_plans_weeks",
      sql`(${table.plan} = 'split') = (${table.weeks} is not null)
        and (${table.weeks} is null or ${table.weeks} between ${sql.raw(String(MINIMUM_SPLIT_WEEKS))} and ${sql.raw(String(MAXIMUM_SPLIT_WEEKS))})`,
    ),
  ],
);

/**
 * Each notice of a one-off charge's debit the Renter was emailed
 * (docs/plans/one-off-charge-notice.md, review fixes 13 Nov 2026): the plan
 * and weeks it stated, its first debit day, and how many parts were already
 * debited then. Added to, never changed: a plan points at its current one,
 * and a change of plan or a lapse needs a new one.
 */
export const debitNotices = pgTable(
  "debit_notices",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    rentalId: uuid("rental_id").notNull(),
    debitPlanId: uuid("debit_plan_id").notNull(),
    plan: debitCollectionPlanEnum("plan").notNull(),
    weeks: integer("weeks"),
    noticeDate: date("notice_date").notNull(),
    partsBefore: integer("parts_before").notNull(),
    /** When the email stating it was sent: its notice days count from that day. */
    emailedAt: timestamp("emailed_at", { withTimezone: true }).notNull(),
    /** The invoice whose email stated it. */
    issuedDocumentId: uuid("issued_document_id").notNull(),
    /** Who pressed Email again; none when the app emailed it itself. */
    givenByUserId: uuid("given_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table): PgTableExtraConfigValue[] => [
    rentalLink("debit_notices", table),
    foreignKey({
      name: "debit_notices_plan_fk",
      columns: [table.debitPlanId, table.operatorId],
      foreignColumns: [debitPlans.id, debitPlans.operatorId],
    }),
    foreignKey({
      name: "debit_notices_document_fk",
      columns: [table.issuedDocumentId, table.operatorId],
      foreignColumns: [issuedDocuments.id, issuedDocuments.operatorId],
    }),
    unique("debit_notices_id_plan_unique").on(table.id, table.operatorId, table.debitPlanId),
    index("debit_notices_plan_idx").on(table.operatorId, table.debitPlanId),
    check("debit_notices_parts_before", sql`${table.partsBefore} >= 0`),
    check(
      "debit_notices_plan",
      sql`${table.plan} <> 'not_debited' and (${table.plan} = 'split') = (${table.weeks} is not null)`,
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
