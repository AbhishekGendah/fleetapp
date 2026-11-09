import {
  bondToCollectCents,
  directDebitState,
  isOvertakenMandate,
  mandateStatusOf,
  type DirectDebitState,
  type MandateEndReason,
  type MandateStatus,
  type PaymentStatus,
  type StripePaymentMethod,
} from "@fleetapp/core";
import { recordActivity } from "@fleetapp/db/activity";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  bondMovements,
  paymentMandates,
  payments,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { ROW_LOCK } from "@fleetapp/db/row-lock";
import { and, asc, eq, lte, ne, sql } from "drizzle-orm";

import { bondAccountIn, type BondMovementRow } from "../bonds/bond-account";
import { lockBondRental } from "../bonds/bond-records";
import type { CheckoutOutcome } from "./payments-provider";
import { businessDayOf } from "./business-day";
import { settleCheckout } from "./stripe-checkouts";

const SYSTEM_ACTOR = { type: "system", id: null } as const;

/** A payment through Stripe on a rental, as its page lists it. Never card or bank details. */
export interface RentalPaymentRow {
  id: string;
  method: StripePaymentMethod;
  amountCents: number;
  status: PaymentStatus;
  failureCode: string | null;
  createdAt: Date;
  settledAt: Date | null;
  /** Refunded in Stripe or taken back by the Renter's bank, less any dispute won (review A5-4). */
  takenBackCents: number;
  /** A dispute with the Renter's bank took money back and it hasn't been given back. */
  isDisputed: boolean;
}

/** A rental's payments by Stripe: the Renter's direct debit, its payments, and the bond still to ask for. */
export interface RentalPayments {
  directDebit: DirectDebitState;
  payments: RentalPaymentRow[];
  bond: { requiredCents: number; heldCents: number; pendingCents: number; toCollectCents: number };
}

export function selectMandates(
  tx: AnyTransaction,
  operatorId: string,
  renterId: string,
): Promise<{ status: MandateStatus; endReason: MandateEndReason | null }[]> {
  return tx
    .select({ status: paymentMandates.status, endReason: paymentMandates.endReason })
    .from(paymentMandates)
    .where(and(eq(paymentMandates.operatorId, operatorId), eq(paymentMandates.renterId, renterId)));
}

/** What refunds and disputes took back from one payment, from the bond entries Stripe's news made. */
function takenBackFrom(
  paymentId: string,
  movements: readonly BondMovementRow[],
): Pick<RentalPaymentRow, "takenBackCents" | "isDisputed"> {
  const undone = new Set(movements.map((movement) => movement.reversesId).filter(Boolean));
  const ofPayment = movements.filter(
    (movement) => movement.paymentId === paymentId && movement.stripeObjectId !== null,
  );
  const out = ofPayment.filter(
    (movement) => movement.kind === "refunded" && !undone.has(movement.id),
  );
  const back = ofPayment.filter((movement) => movement.kind === "received");
  const total = (entries: readonly BondMovementRow[]) =>
    entries.reduce((sum, entry) => sum + entry.amountCents, 0);
  const wonIds = new Set(back.map((movement) => movement.stripeObjectId));
  return {
    takenBackCents: Math.max(total(out) - total(back), 0),
    isDisputed: out.some(
      (movement) => movement.stripeObjectKind === "dispute" && !wonIds.has(movement.stripeObjectId),
    ),
  };
}

async function selectRentalPayments(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<Omit<RentalPaymentRow, "takenBackCents" | "isDisputed">[]> {
  const rows = await tx
    .select({
      id: payments.id,
      method: payments.method,
      amountCents: payments.amountCents,
      status: payments.status,
      failureCode: payments.failureCode,
      createdAt: payments.createdAt,
      settledAt: payments.settledAt,
    })
    .from(payments)
    .where(and(eq(payments.operatorId, operatorId), eq(payments.rentalId, rentalId)))
    .orderBy(asc(payments.createdAt));
  // The database allows only card and BECS here (payments_method).
  return rows.map((row) => ({ ...row, method: row.method as StripePaymentMethod }));
}

/** Everything about a rental's payments by Stripe, worked out from the records (never stored). */
export async function loadRentalPayments(
  database: AnyDatabase,
  operatorId: string,
  rental: { id: string; renterId: string; bondCents: number },
): Promise<RentalPayments> {
  return withTenant(database, operatorId, (tx) => rentalPaymentsIn(tx, operatorId, rental));
}

export async function rentalPaymentsIn(
  tx: AnyTransaction,
  operatorId: string,
  rental: { id: string; renterId: string; bondCents: number },
): Promise<RentalPayments> {
  const [mandates, rows, bond] = await Promise.all([
    selectMandates(tx, operatorId, rental.renterId),
    selectRentalPayments(tx, operatorId, rental.id),
    bondAccountIn(tx, operatorId, rental),
  ]);
  const { heldCents } = bond;
  const paymentRows = rows.map((row) => ({ ...row, ...takenBackFrom(row.id, bond.movements) }));
  // A finished Stripe page whose payment isn't recorded yet is on its way too (review KS-1).
  const pendingCents = bond.onItsWayCents;
  return {
    directDebit: directDebitState(mandates),
    payments: paymentRows,
    bond: {
      requiredCents: rental.bondCents,
      heldCents,
      pendingCents,
      toCollectCents: bondToCollectCents({
        requiredCents: rental.bondCents,
        heldCents,
        pendingCents,
      }),
    },
  };
}

/**
 * Ends, as replaced, the Renter's direct debits set up before the one now
 * working (review KS-2): only one can be debited (rule 16's one method).
 * Called only once the new one is active, so a Renter whose new bank
 * account fails its checks keeps the old one (deep review of batch 2).
 * Each ended one is then detached at Stripe after the save.
 */
async function endOlderMandates(
  tx: AnyTransaction,
  operatorId: string,
  current: { renterId: string; setUpAt: Date; id?: string },
  now: Date,
): Promise<void> {
  const ended = await tx
    .update(paymentMandates)
    .set({ status: "inactive", endReason: "replaced", endedAt: now, updatedAt: now })
    .where(
      and(
        eq(paymentMandates.operatorId, operatorId),
        eq(paymentMandates.renterId, current.renterId),
        ne(paymentMandates.status, "inactive"),
        lte(paymentMandates.setUpAt, current.setUpAt),
        current.id ? ne(paymentMandates.id, current.id) : undefined,
      ),
    )
    .returning({ id: paymentMandates.id });
  for (const mandate of ended) {
    await logSystem(tx, operatorId, ACTIVITY_ENTITY_TYPES.paymentMandate, mandate.id, {
      status: "inactive",
      endReason: "replaced",
    });
  }
}

/** The Renter's direct debits, locked, so two of Stripe's messages can't both pick the current one. */
function lockRenterMandates(tx: AnyTransaction, operatorId: string, renterId: string) {
  return tx
    .select({ id: paymentMandates.id, setUpAt: paymentMandates.setUpAt })
    .from(paymentMandates)
    .where(and(eq(paymentMandates.operatorId, operatorId), eq(paymentMandates.renterId, renterId)))
    .for(ROW_LOCK);
}

function logSystem(
  tx: AnyTransaction,
  operatorId: string,
  entityType: (typeof ACTIVITY_ENTITY_TYPES)["paymentMandate" | "payment"],
  entityId: string,
  valuesAfter: Record<string, unknown>,
): Promise<void> {
  return recordActivity(tx, {
    operatorId,
    actor: SYSTEM_ACTOR,
    entityType,
    entityId,
    action: ACTIVITY_ACTIONS.statusChanged,
    valuesAfter,
  });
}

/** The columns for a direct debit moving to a status: when it started, or why it ended. */
function mandateChange(status: MandateStatus, now: Date) {
  return {
    status,
    ...(status === "active" ? { activatedAt: now } : {}),
    endReason: status === "inactive" ? ("cancelled" as const) : null,
    endedAt: status === "inactive" ? now : null,
  };
}

/**
 * A direct debit the Renter set up on Stripe's page, kept once however
 * often Stripe tells us. The newest one set up is the current one: one
 * set up earlier that Stripe tells us about late is kept as replaced.
 */
async function recordMandate(
  tx: AnyTransaction,
  operatorId: string,
  outcome: CheckoutOutcome,
  now: Date,
): Promise<void> {
  const { reference, setup } = outcome;
  if (!reference || !setup) {
    return;
  }
  const others = await lockRenterMandates(tx, operatorId, reference.renterId);
  const [existing] = await tx
    .select({ id: paymentMandates.id })
    .from(paymentMandates)
    .where(eq(paymentMandates.stripeSetupIntentId, setup.setupIntentId));
  if (existing) {
    return;
  }
  const isOvertaken = isOvertakenMandate(setup.setUpAt, others);
  const status = isOvertaken ? "inactive" : mandateStatusOf(setup.mandateStatus);
  if (status === "active") {
    await endOlderMandates(
      tx,
      operatorId,
      { renterId: reference.renterId, setUpAt: setup.setUpAt },
      now,
    );
  }
  const [added] = await tx
    .insert(paymentMandates)
    .values({
      operatorId,
      renterId: reference.renterId,
      method: "becs_debit",
      status,
      ...(status === "active" ? { activatedAt: now } : {}),
      endReason: isOvertaken ? "replaced" : status === "inactive" ? "cancelled" : null,
      endedAt: status === "inactive" ? now : null,
      stripeSetupIntentId: setup.setupIntentId,
      stripePaymentMethodId: setup.paymentMethodId,
      stripeMandateId: setup.mandateId,
      linkId: reference.linkId,
      setUpAt: setup.setUpAt,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: paymentMandates.id });
  if (added) {
    await recordActivity(tx, {
      operatorId,
      actor: { type: "renter_link", id: reference.linkId },
      entityType: ACTIVITY_ENTITY_TYPES.paymentMandate,
      entityId: added.id,
      action: ACTIVITY_ACTIONS.created,
      valuesAfter: {
        renterId: reference.renterId,
        method: "becs_debit",
        status,
        ...(isOvertaken ? { endReason: "replaced" } : {}),
      },
    });
  }
}

const PAYMENT_STATUS_OF: Readonly<
  Record<NonNullable<CheckoutOutcome["payment"]>["status"], PaymentStatus>
> = {
  paid: "succeeded",
  processing: "pending",
  failed: "failed",
};

/** The bond entry for a payment Stripe says succeeded (decision 2): once, for exactly its amount. */
async function addBondReceived(
  tx: AnyTransaction,
  operatorId: string,
  payment: { id: string; rentalId: string; method: StripePaymentMethod; amountCents: number },
  occurredAt: Date,
): Promise<void> {
  const [movement] = await tx
    .insert(bondMovements)
    .values({
      operatorId,
      rentalId: payment.rentalId,
      kind: "received",
      amountCents: payment.amountCents,
      method: payment.method,
      occurredOn: await businessDayOf(tx, operatorId, occurredAt),
      paymentId: payment.id,
    })
    .onConflictDoNothing({
      target: bondMovements.paymentId,
      // The partial unique index bond_movements_one_per_payment.
      where: sql`${bondMovements.kind} = 'received' and ${bondMovements.stripeObjectId} is null`,
    })
    .returning({ id: bondMovements.id });
  if (movement) {
    await recordActivity(tx, {
      operatorId,
      actor: SYSTEM_ACTOR,
      entityType: ACTIVITY_ENTITY_TYPES.bondMovement,
      entityId: movement.id,
      action: ACTIVITY_ACTIONS.created,
      valuesAfter: {
        rentalId: payment.rentalId,
        kind: "received",
        amountCents: payment.amountCents,
        method: payment.method,
        paymentId: payment.id,
      },
    });
  }
}

/**
 * A bond paid on Stripe's page: kept the first time Stripe tells us, then
 * moved on as Stripe reports (a bank debit clears days later). Only a
 * success puts it on the bond.
 */
async function recordBondPayment(
  tx: AnyTransaction,
  operatorId: string,
  outcome: CheckoutOutcome,
  times: { now: Date; occurredAt: Date },
): Promise<void> {
  const { now } = times;
  const { reference, payment } = outcome;
  if (!reference || !payment) {
    return;
  }
  const status = PAYMENT_STATUS_OF[payment.status];
  const settledAt = status === "pending" ? null : now;
  const [added] = await tx
    .insert(payments)
    .values({
      operatorId,
      renterId: reference.renterId,
      rentalId: reference.rentalId,
      purpose: "bond",
      method: payment.method,
      amountCents: payment.amountCents,
      status,
      stripeCheckoutSessionId: outcome.sessionId,
      stripePaymentIntentId: payment.paymentIntentId,
      failureCode: payment.failureCode,
      settledAt,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: payments.stripeCheckoutSessionId })
    .returning({ id: payments.id });
  const [row] = added
    ? [{ id: added.id, status: "new" as const }]
    : await tx
        .select({ id: payments.id, status: payments.status })
        .from(payments)
        .where(eq(payments.stripeCheckoutSessionId, outcome.sessionId))
        .for(ROW_LOCK);
  if (!row) {
    return;
  }
  if (row.status === "pending" && status !== "pending") {
    await tx
      .update(payments)
      .set({ status, failureCode: payment.failureCode, settledAt, updatedAt: now })
      .where(eq(payments.id, row.id));
  } else if (row.status !== "new") {
    // Told again, or out of order: what is recorded already stands.
    return;
  }
  await logSystem(tx, operatorId, ACTIVITY_ENTITY_TYPES.payment, row.id, {
    rentalId: reference.rentalId,
    purpose: "bond",
    method: payment.method,
    amountCents: payment.amountCents,
    status,
  });
  if (status === "succeeded") {
    await addBondReceived(
      tx,
      operatorId,
      {
        id: row.id,
        rentalId: reference.rentalId,
        method: payment.method,
        amountCents: payment.amountCents,
      },
      times.occurredAt,
    );
  }
}

/** What came of a visit to Stripe's page, applied inside the business's own transaction. */
export async function applyCheckoutOutcome(
  tx: AnyTransaction,
  operatorId: string,
  outcome: CheckoutOutcome,
  now: Date,
  /** When Stripe says it happened, if known: a bond paid is dated by it (review A11-10). */
  occurredAt: Date = now,
): Promise<void> {
  const { reference } = outcome;
  // The rental first, before the page's own row ("Lock order"): bond entered
  // by hand takes it too, so the two go one after the other and each sees
  // what the other recorded (no bond held twice, none taken below nothing).
  const rental =
    outcome.isComplete && reference
      ? await lockBondRental(tx, operatorId, reference.rentalId)
      : null;
  await settleCheckout(tx, operatorId, outcome, now);
  // The session's account is this business's (rule 3), so its rental must be
  // too; one that is not is ignored, never recorded against anyone.
  if (!reference || !rental || rental.renterId !== reference.renterId) {
    return;
  }
  if (reference.purpose === "direct_debit") {
    await recordMandate(tx, operatorId, outcome, now);
    return;
  }
  await recordBondPayment(tx, operatorId, outcome, { now, occurredAt });
}

/** Whether we have recorded a direct debit yet: Stripe's news about one we haven't is sent again later. */
export async function isMandateKnown(tx: AnyTransaction, mandateId: string): Promise<boolean> {
  const [mandate] = await tx
    .select({ id: paymentMandates.id })
    .from(paymentMandates)
    .where(eq(paymentMandates.stripeMandateId, mandateId));
  return mandate !== undefined;
}

/**
 * A direct debit's status as Stripe now says (the Renter's bank cancelled
 * it, or it finished being checked). One already ended stays ended, so an
 * older one replaced can never come back (review KS-2).
 */
export async function applyMandateStatus(
  tx: AnyTransaction,
  operatorId: string,
  update: { mandateId: string; stripeStatus: string },
  now: Date,
): Promise<void> {
  const [mandate] = await tx
    .select({
      id: paymentMandates.id,
      renterId: paymentMandates.renterId,
      status: paymentMandates.status,
      setUpAt: paymentMandates.setUpAt,
    })
    .from(paymentMandates)
    .where(eq(paymentMandates.stripeMandateId, update.mandateId))
    .for(ROW_LOCK);
  const status = mandateStatusOf(update.stripeStatus);
  if (!mandate || mandate.status === "inactive" || mandate.status === status) {
    return;
  }
  if (status === "active") {
    // Now working: the ones set up before it are replaced (the one-active rule needs them gone first).
    await endOlderMandates(tx, operatorId, mandate, now);
  }
  await tx
    .update(paymentMandates)
    .set({ ...mandateChange(status, now), updatedAt: now })
    .where(eq(paymentMandates.id, mandate.id));
  await logSystem(tx, operatorId, ACTIVITY_ENTITY_TYPES.paymentMandate, mandate.id, { status });
}
