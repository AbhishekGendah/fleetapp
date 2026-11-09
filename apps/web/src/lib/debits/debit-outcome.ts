import { DEBIT_NOT_SENT_CODE } from "@fleetapp/core";
import { recordActivity } from "@fleetapp/db/activity";
import type { AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  paymentMandates,
  payments,
  renterStripeCustomers,
} from "@fleetapp/db/schema";
import { and, eq, isNull } from "drizzle-orm";

import { lockPaymentRental } from "../bonds/bond-records";
import { businessDayOf } from "../payments/business-day";
import type { DebitRead } from "../payments/payments-provider";
import { addStripeLineOnce } from "./stripe-ledger-lines";
import { IS_DEBIT } from "./debit-queries";

const SYSTEM_ACTOR = { type: "system", id: null } as const;

/** A debit row as Stripe's news is applied to it, read under its lock. */
interface LockedDebit {
  id: string;
  rentalId: string;
  amountCents: number;
  status: "pending" | "succeeded" | "failed" | "refunded";
  stripePaymentIntentId: string | null;
  stripeFeeCents: number | null;
}

/**
 * Our debit Stripe's read is about, within this business only (rule 3): by
 * its Stripe ID, or, before that was saved, by our payment ID in Stripe's
 * metadata, trusted only when the amount, customer and direct debit agree
 * with our row (a pointer, never proof).
 */
async function debitOfRead(
  tx: AnyTransaction,
  operatorId: string,
  read: DebitRead,
): Promise<{ id: string; rentalId: string } | null> {
  const [byIntent] = await tx
    .select({ id: payments.id, rentalId: payments.rentalId })
    .from(payments)
    .where(
      and(
        eq(payments.operatorId, operatorId),
        eq(payments.stripePaymentIntentId, read.paymentIntentId),
        IS_DEBIT,
      ),
    );
  if (byIntent || !read.paymentId) {
    return byIntent ?? null;
  }
  const [reserved] = await tx
    .select({
      id: payments.id,
      rentalId: payments.rentalId,
      amountCents: payments.amountCents,
      mandateId: paymentMandates.stripeMandateId,
      customerId: renterStripeCustomers.stripeCustomerId,
    })
    .from(payments)
    .innerJoin(
      paymentMandates,
      and(eq(paymentMandates.id, payments.mandateId), eq(paymentMandates.operatorId, operatorId)),
    )
    .innerJoin(
      renterStripeCustomers,
      and(
        eq(renterStripeCustomers.renterId, payments.renterId),
        eq(renterStripeCustomers.operatorId, operatorId),
      ),
    )
    .where(
      and(
        eq(payments.operatorId, operatorId),
        eq(payments.id, read.paymentId),
        isNull(payments.stripePaymentIntentId),
        IS_DEBIT,
      ),
    );
  const isSame =
    reserved !== undefined &&
    reserved.amountCents === read.amountCents &&
    reserved.customerId === read.customerId &&
    reserved.mandateId === read.mandateId;
  return isSame ? { id: reserved.id, rentalId: reserved.rentalId } : null;
}

/**
 * The debit, locked FOR UPDATE ("Lock order", kept as FOR UPDATE): saving
 * Stripe's ID writes a column with a unique key, which takes that lock
 * anyway, so it is taken here at the start. Always under the rental's lock.
 */
async function lockDebit(tx: AnyTransaction, paymentId: string): Promise<LockedDebit | null> {
  const [debit] = await tx
    .select({
      id: payments.id,
      rentalId: payments.rentalId,
      amountCents: payments.amountCents,
      status: payments.status,
      stripePaymentIntentId: payments.stripePaymentIntentId,
      stripeFeeCents: payments.stripeFeeCents,
    })
    .from(payments)
    .where(eq(payments.id, paymentId))
    // eslint-disable-next-line no-restricted-syntax -- a unique key is written: see above.
    .for("update");
  return debit ?? null;
}

/** Stripe's ID and fee, each written once; the status moved on if Stripe says it settled. */
function changesFor(debit: LockedDebit, read: DebitRead, now: Date) {
  const isSettling = debit.status === "pending" && read.status !== "processing";
  return {
    ...(debit.stripePaymentIntentId === null
      ? { stripePaymentIntentId: read.paymentIntentId }
      : {}),
    ...(debit.stripeFeeCents === null && read.feeCents !== null
      ? { stripeFeeCents: read.feeCents }
      : {}),
    ...(isSettling
      ? {
          status: read.status === "succeeded" ? ("succeeded" as const) : ("failed" as const),
          failureCode: read.status === "failed" ? read.failureCode : null,
          settledAt: now,
        }
      : {}),
  };
}

/**
 * What Stripe says of a debit, applied once in the business's own
 * transaction: its Stripe ID and fee saved, and, when it cleared, a payment
 * line on the ledger (decision 2: counted only when the money arrived),
 * dated the business's own day it happened. The rental is locked first
 * ("Lock order"), then the debit. Recorded whatever the rental's status:
 * the money really moved. Gives back the rental if a line was added.
 */
export async function applyDebitRead(
  tx: AnyTransaction,
  operatorId: string,
  read: DebitRead,
  times: { now: Date; occurredAt: Date },
): Promise<string | null> {
  const found = await debitOfRead(tx, operatorId, read);
  if (!found || !(await lockPaymentRental(tx, operatorId, found.rentalId))) {
    return null;
  }
  const debit = await lockDebit(tx, found.id);
  if (!debit || (debit.stripePaymentIntentId ?? read.paymentIntentId) !== read.paymentIntentId) {
    return null;
  }
  const changes = changesFor(debit, read, times.now);
  if (Object.keys(changes).length > 0) {
    await tx
      .update(payments)
      .set({ ...changes, updatedAt: times.now })
      .where(eq(payments.id, debit.id));
  }
  if ("status" in changes) {
    await recordActivity(tx, {
      operatorId,
      actor: SYSTEM_ACTOR,
      entityType: ACTIVITY_ENTITY_TYPES.payment,
      entityId: debit.id,
      action: ACTIVITY_ACTIONS.statusChanged,
      valuesAfter: { status: changes.status, amountCents: debit.amountCents },
    });
  }
  const hasCleared = read.status === "succeeded" && debit.status !== "failed";
  if (!hasCleared) {
    return null;
  }
  const isAdded = await addStripeLineOnce(tx, operatorId, {
    rentalId: debit.rentalId,
    paymentId: debit.id,
    reason: "settled",
    stripeObjectId: null,
    amountCents: debit.amountCents,
    effectiveOn: await businessDayOf(tx, operatorId, times.occurredAt),
  });
  return isAdded ? debit.rentalId : null;
}

/**
 * A reserved debit that never became one at Stripe: refused at once (with
 * Stripe's reason, and its ID if it gave one), or never made at all
 * (recovery found none after a day: "not sent", ours, not the Renter's, so
 * slice 6 sends no "your payment failed" email). Failed, never sent again.
 * Left alone if Stripe's news already gave it a Stripe ID.
 */
export async function failReservedDebit(
  tx: AnyTransaction,
  operatorId: string,
  debit: { id: string; rentalId: string },
  failure: { failureCode: string | null; paymentIntentId: string | null },
  now: Date,
): Promise<void> {
  if (!(await lockPaymentRental(tx, operatorId, debit.rentalId))) {
    return;
  }
  const locked = await lockDebit(tx, debit.id);
  if (!locked || locked.status !== "pending" || locked.stripePaymentIntentId !== null) {
    return;
  }
  await tx
    .update(payments)
    .set({
      status: "failed",
      failureCode: failure.failureCode,
      settledAt: now,
      updatedAt: now,
      ...(failure.paymentIntentId ? { stripePaymentIntentId: failure.paymentIntentId } : {}),
    })
    .where(eq(payments.id, debit.id));
  await recordActivity(tx, {
    operatorId,
    actor: SYSTEM_ACTOR,
    entityType: ACTIVITY_ENTITY_TYPES.payment,
    entityId: debit.id,
    action: ACTIVITY_ACTIONS.statusChanged,
    valuesAfter: { status: "failed", failureCode: failure.failureCode },
  });
}

/** The "not sent" failure recovery records. */
export const NOT_SENT = { failureCode: DEBIT_NOT_SENT_CODE, paymentIntentId: null } as const;
