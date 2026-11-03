import { STRIPE_CAPABILITY_STATUSES } from "@fleetapp/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { timestampColumns } from "./columns";
import { operators } from "./operators";

export const stripeCapabilityStatusEnum = pgEnum(
  "stripe_capability_status",
  STRIPE_CAPABILITY_STATUSES,
);

/**
 * A business's own Stripe account (docs/plans/phase-4.md, slice 3): its ID
 * and what Stripe last said it can do. One per business; the details the
 * business gave Stripe stay with Stripe.
 */
export const stripeAccounts = pgTable(
  "stripe_accounts",
  {
    operatorId: uuid("operator_id")
      .primaryKey()
      .references(() => operators.id),
    stripeAccountId: text("stripe_account_id").notNull().unique(),
    /** Made in Stripe's live mode, not a sandbox. */
    isLive: boolean("is_live").notNull(),
    cardPayments: stripeCapabilityStatusEnum("card_payments").notNull().default("pending"),
    becsDebitPayments: stripeCapabilityStatusEnum("becs_debit_payments")
      .notNull()
      .default("pending"),
    requirementsDue: integer("requirements_due").notNull().default(0),
    /** When Stripe was last asked; the status is always read from Stripe, never from the browser. */
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => [
    check("stripe_accounts_id_shape", sql`${table.stripeAccountId} ~ '^acct_[A-Za-z0-9]+$'`),
    check("stripe_accounts_requirements", sql`${table.requirementsDue} >= 0`),
  ],
);

/**
 * Every event Stripe has sent, by its ID, so a repeat is ignored (rule 20).
 * Not a business's own table: an event is recorded before its business is
 * known, and only through app.record_stripe_event.
 */
export const stripeEvents = pgTable("stripe_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  /** The business it turned out to be about, once found from its account (rule 3). */
  operatorId: uuid("operator_id").references(() => operators.id),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});
