import {
  OVER_LIMIT_FAILURE_CODES,
  OVER_LIMIT_REMINDER_DAYS,
  MILLISECONDS_PER_DAY,
  type PaymentPurpose,
  type PaymentStatus,
} from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  activityLog,
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  paymentMandates,
  payments,
  rentals,
  renterStripeCustomers,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, desc, eq, gte, inArray, isNull, lte, ne, sql, sum } from "drizzle-orm";

/** The Renter's direct debit that can be debited now: active, its bank account still attached. */
export interface UsableMandate {
  id: string;
  stripePaymentMethodId: string;
  stripeMandateId: string;
}

export async function usableMandateOf(
  tx: AnyTransaction,
  operatorId: string,
  renterId: string,
): Promise<UsableMandate | null> {
  const [mandate] = await tx
    .select({
      id: paymentMandates.id,
      stripePaymentMethodId: paymentMandates.stripePaymentMethodId,
      stripeMandateId: paymentMandates.stripeMandateId,
    })
    .from(paymentMandates)
    .where(
      and(
        eq(paymentMandates.operatorId, operatorId),
        eq(paymentMandates.renterId, renterId),
        eq(paymentMandates.status, "active"),
        isNull(paymentMandates.detachedAt),
      ),
    );
  return mandate ?? null;
}

/** The Renter as a customer on the business's Stripe account, if made. */
export async function stripeCustomerOf(
  tx: AnyTransaction,
  operatorId: string,
  renterId: string,
): Promise<string | null> {
  const [customer] = await tx
    .select({ id: renterStripeCustomers.stripeCustomerId })
    .from(renterStripeCustomers)
    .where(
      and(
        eq(renterStripeCustomers.operatorId, operatorId),
        eq(renterStripeCustomers.renterId, renterId),
      ),
    );
  return customer?.id ?? null;
}

/** Only payments the app debits itself (never a bond on Stripe's page). */
export const IS_DEBIT = ne(payments.purpose, "bond");

/** What the rental's debits still on their way at the bank add up to. */
export async function pendingDebitCents(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<number> {
  const [row] = await tx
    .select({ cents: sum(payments.amountCents).mapWith(Number) })
    .from(payments)
    .where(
      and(
        eq(payments.operatorId, operatorId),
        eq(payments.rentalId, rentalId),
        eq(payments.status, "pending"),
        IS_DEBIT,
      ),
    );
  return row?.cents ?? 0;
}

/**
 * When the rental's automatic debits were last resumed, if ever: from the
 * resume's own entry in the activity log, written in the same transaction
 * as the resume (rule 19). Weeks begun before it, while paused, are not
 * debited later.
 */
export async function debitsResumedAt(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<Date | null> {
  const [entry] = await tx
    .select({ at: activityLog.occurredAt })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.operatorId, operatorId),
        eq(activityLog.entityType, ACTIVITY_ENTITY_TYPES.rental),
        eq(activityLog.entityId, rentalId),
        eq(activityLog.action, ACTIVITY_ACTIONS.debitsResumed),
      ),
    )
    .orderBy(desc(activityLog.occurredAt))
    .limit(1);
  return entry?.at ?? null;
}

/** A debit on a rental, as its page lists it. Never bank details. */
export interface RentalDebitRow {
  id: string;
  purpose: PaymentPurpose;
  amountCents: number;
  status: PaymentStatus;
  failureCode: string | null;
  feeCents: number | null;
  periodStartsAt: Date | null;
  requestedAt: Date;
  settledAt: Date | null;
}

export async function loadRentalDebits(
  database: AnyDatabase,
  operatorId: string,
  rentalId: string,
): Promise<RentalDebitRow[]> {
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        id: payments.id,
        purpose: payments.purpose,
        amountCents: payments.amountCents,
        status: payments.status,
        failureCode: payments.failureCode,
        feeCents: payments.stripeFeeCents,
        periodStartsAt: payments.periodStartsAt,
        requestedAt: payments.requestedAt,
        settledAt: payments.settledAt,
      })
      .from(payments)
      .where(and(eq(payments.operatorId, operatorId), eq(payments.rentalId, rentalId), IS_DEBIT))
      .orderBy(desc(payments.requestedAt)),
  );
  // A debit always has its request time (payments_purpose_details).
  return rows.map((row) => ({ ...row, requestedAt: row.requestedAt ?? new Date(0) }));
}

/** A business's debits across its cars: what is on its way, and the last one that cleared. */
export interface RenterDebitSummary {
  pendingCents: number;
  pendingCars: number;
  lastCleared: { amountCents: number; settledAt: Date } | null;
}

export async function loadRenterDebitSummary(
  database: AnyDatabase,
  operatorId: string,
  renterId: string,
): Promise<RenterDebitSummary> {
  return withTenant(database, operatorId, async (tx) => {
    const ofRenter = and(
      eq(payments.operatorId, operatorId),
      eq(payments.renterId, renterId),
      IS_DEBIT,
    );
    const [pending] = await tx
      .select({
        cents: sum(payments.amountCents).mapWith(Number),
        cars: sql<number>`count(distinct ${rentals.vehicleId})`.mapWith(Number),
      })
      .from(payments)
      .innerJoin(
        rentals,
        and(eq(rentals.id, payments.rentalId), eq(rentals.operatorId, payments.operatorId)),
      )
      .where(and(ofRenter, eq(payments.status, "pending")));
    const [cleared] = await tx
      .select({ amountCents: payments.amountCents, settledAt: payments.settledAt })
      .from(payments)
      .where(and(ofRenter, inArray(payments.status, ["succeeded", "refunded"])))
      .orderBy(desc(payments.settledAt))
      .limit(1);
    return {
      pendingCents: pending?.cents ?? 0,
      pendingCars: pending?.cars ?? 0,
      lastCleared: cleared?.settledAt
        ? { amountCents: cleared.amountCents, settledAt: cleared.settledAt }
        : null,
    };
  });
}

/** Whether Stripe refused a debit over the business's BECS limit in the last 30 days. */
export async function wasRefusedOverLimitRecently(
  database: AnyDatabase,
  operatorId: string,
  now: Date,
): Promise<boolean> {
  const since = new Date(now.getTime() - OVER_LIMIT_REMINDER_DAYS * MILLISECONDS_PER_DAY);
  const [refused] = await withTenant(database, operatorId, (tx) =>
    tx
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.operatorId, operatorId),
          eq(payments.status, "failed"),
          inArray(payments.failureCode, [...OVER_LIMIT_FAILURE_CODES]),
          gte(payments.settledAt, since),
        ),
      )
      .limit(1),
  );
  return refused !== undefined;
}

/**
 * Whether a debit of this business may still be on its way to being
 * recorded: one reserved before `reservedBefore` whose Stripe ID isn't
 * saved yet. A refund or dispute about a payment we don't know waits for
 * it, as one waits for a bond payment (isBondPaymentAwaited).
 */
export async function isDebitAwaited(
  tx: AnyTransaction,
  operatorId: string,
  reservedBefore: Date,
): Promise<boolean> {
  const [awaited] = await tx
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        eq(payments.operatorId, operatorId),
        IS_DEBIT,
        isNull(payments.stripePaymentIntentId),
        eq(payments.status, "pending"),
        lte(payments.requestedAt, reservedBefore),
      ),
    )
    .limit(1);
  return awaited !== undefined;
}

/** Whether the Renter pays by a working direct debit now (for a page, outside any change). */
export async function hasUsableMandateFor(
  database: AnyDatabase,
  operatorId: string,
  renterId: string,
): Promise<boolean> {
  const mandate = await withTenant(database, operatorId, (tx) =>
    usableMandateOf(tx, operatorId, renterId),
  );
  return mandate !== null;
}
