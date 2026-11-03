import {
  MANDATE_END_REASONS,
  MANDATE_STATUSES,
  PAYMENT_PURPOSES,
  PAYMENT_STATUSES,
} from "@fleetapp/core";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  integer,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { primaryKeyColumn, timestampColumns } from "./columns";
import { paymentMethodEnum } from "./enums";
import { operatorIdColumn } from "./operators";
import { rentals } from "./rentals";
import { renterLinks } from "./renter-links";
import { renters } from "./renters";

export const mandateStatusEnum = pgEnum("mandate_status", MANDATE_STATUSES);
export const mandateEndReasonEnum = pgEnum("mandate_end_reason", MANDATE_END_REASONS);
export const paymentStatusEnum = pgEnum("payment_status", PAYMENT_STATUSES);
export const paymentPurposeEnum = pgEnum("payment_purpose", PAYMENT_PURPOSES);

/**
 * The Renter as a customer on the business's own Stripe account (decision
 * 1: the business is the merchant). One per Renter; Stripe holds their
 * name, email and payment details, we only its ID (rule 7).
 */
export const renterStripeCustomers = pgTable(
  "renter_stripe_customers",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    renterId: uuid("renter_id").notNull(),
    stripeCustomerId: text("stripe_customer_id").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    foreignKey({
      name: "renter_stripe_customers_renter_fk",
      columns: [table.renterId, table.operatorId],
      foreignColumns: [renters.id, renters.operatorId],
    }),
    unique("renter_stripe_customers_one_per_renter").on(table.operatorId, table.renterId),
    check(
      "renter_stripe_customers_id_shape",
      sql`${table.stripeCustomerId} ~ '^cus_[A-Za-z0-9]+$'`,
    ),
  ],
);

/**
 * A direct debit the Renter set up on Stripe's page, accepting Stripe's
 * Direct Debit Request there: Stripe's IDs and the method type only (rules
 * 7 and 16). Its status follows what Stripe says. One active per Renter: a
 * newer one replaces the old.
 */
export const paymentMandates = pgTable(
  "payment_mandates",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    renterId: uuid("renter_id").notNull(),
    method: paymentMethodEnum("method").notNull(),
    status: mandateStatusEnum("status").notNull(),
    endReason: mandateEndReasonEnum("end_reason"),
    stripeSetupIntentId: text("stripe_setup_intent_id").notNull().unique(),
    stripePaymentMethodId: text("stripe_payment_method_id").notNull(),
    stripeMandateId: text("stripe_mandate_id").notNull().unique(),
    /** The Renter's link it was set up through. */
    linkId: uuid("link_id"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => [
    foreignKey({
      name: "payment_mandates_renter_fk",
      columns: [table.renterId, table.operatorId],
      foreignColumns: [renters.id, renters.operatorId],
    }),
    foreignKey({
      name: "payment_mandates_link_fk",
      columns: [table.linkId, table.renterId, table.operatorId],
      foreignColumns: [renterLinks.id, renterLinks.renterId, renterLinks.operatorId],
    }),
    uniqueIndex("payment_mandates_one_active")
      .on(table.operatorId, table.renterId)
      .where(sql`${table.status} = 'active'`),
    index("payment_mandates_renter_idx").on(table.operatorId, table.renterId),
    check("payment_mandates_method", sql`${table.method} = 'becs_debit'`),
    check(
      "payment_mandates_ended",
      sql`(${table.status} = 'inactive') = (${table.endReason} is not null)
        and (${table.endReason} is null) = (${table.endedAt} is null)`,
    ),
    check(
      "payment_mandates_id_shapes",
      sql`${table.stripeSetupIntentId} ~ '^seti_[A-Za-z0-9]+$'
        and ${table.stripePaymentMethodId} ~ '^pm_[A-Za-z0-9]+$'
        and ${table.stripeMandateId} ~ '^mandate_[A-Za-z0-9]+$'`,
    ),
  ],
);

/**
 * A payment the Renter made through Stripe (docs/design/06): recorded when
 * Stripe says it was made, and counted only once Stripe says it succeeded
 * (decision 2). The amount and method never change; only its status moves,
 * forward, as Stripe reports it.
 */
export const payments = pgTable(
  "payments",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,
    renterId: uuid("renter_id").notNull(),
    rentalId: uuid("rental_id").notNull(),
    purpose: paymentPurposeEnum("purpose").notNull(),
    method: paymentMethodEnum("method").notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: paymentStatusEnum("status").notNull(),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").notNull().unique(),
    stripePaymentIntentId: text("stripe_payment_intent_id").notNull().unique(),
    /** Stripe's reason code for a failure; never the bank's or card's details. */
    failureCode: text("failure_code"),
    /** When it succeeded or failed. */
    settledAt: timestamp("settled_at", { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => [
    foreignKey({
      name: "payments_rental_fk",
      columns: [table.rentalId, table.operatorId],
      foreignColumns: [rentals.id, rentals.operatorId],
    }),
    foreignKey({
      name: "payments_renter_fk",
      columns: [table.renterId, table.operatorId],
      foreignColumns: [renters.id, renters.operatorId],
    }),
    // Lets a bond entry name its payment and its rental together, so the two always match.
    unique("payments_id_rental_unique").on(table.id, table.operatorId, table.rentalId),
    index("payments_rental_idx").on(table.operatorId, table.rentalId),
    check("payments_amount", sql`${table.amountCents} > 0`),
    check("payments_method", sql`${table.method} in ('card', 'becs_debit')`),
    check("payments_settled", sql`(${table.status} = 'pending') = (${table.settledAt} is null)`),
    check(
      "payments_id_shapes",
      sql`${table.stripeCheckoutSessionId} ~ '^cs_[A-Za-z0-9_]+$'
        and ${table.stripePaymentIntentId} ~ '^pi_[A-Za-z0-9]+$'`,
    ),
  ],
);
