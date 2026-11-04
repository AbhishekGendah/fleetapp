import {
  bondToCollectCents,
  directDebitState,
  isOvertakenMandate,
  mandateStatusOf,
  todayInTimeZone,
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
  operators,
  paymentMandates,
  payments,
  rentals,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, asc, eq, ne, sql } from "drizzle-orm";

import { bondAccountOf, selectBondMovements } from "../bonds/bond-account";
import type { CheckoutOutcome } from "./payments-provider";

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

async function selectRentalPayments(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<RentalPaymentRow[]> {
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
  const [mandates, rows, movements] = await Promise.all([
    selectMandates(tx, operatorId, rental.renterId),
    selectRentalPayments(tx, operatorId, rental.id),
    selectBondMovements(tx, operatorId, rental.id),
  ]);
  const { heldCents } = bondAccountOf(movements, rental.bondCents);
  const pendingCents = rows
    .filter((row) => row.status === "pending")
    .reduce((sum, row) => sum + row.amountCents, 0);
  return {
    directDebit: directDebitState(mandates),
    payments: rows,
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
 * Ends every direct debit of the Renter's still waiting or active, as
 * replaced by the one about to be kept (review KS-2): only one can be debited (rule
 * 16's one method). Each is then detached at Stripe after the save.
 */
async function endOtherMandates(
  tx: AnyTransaction,
  operatorId: string,
  renterId: string,
  now: Date,
): Promise<void> {
  const ended = await tx
    .update(paymentMandates)
    .set({ status: "inactive", endReason: "replaced", endedAt: now, updatedAt: now })
    .where(
      and(
        eq(paymentMandates.operatorId, operatorId),
        eq(paymentMandates.renterId, renterId),
        ne(paymentMandates.status, "inactive"),
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
    .for("update");
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
  if (status !== "inactive") {
    await endOtherMandates(tx, operatorId, reference.renterId, now);
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

async function businessToday(tx: AnyTransaction, operatorId: string, now: Date): Promise<string> {
  const [operator] = await tx
    .select({ timeZone: operators.timezone })
    .from(operators)
    .where(eq(operators.id, operatorId));
  if (!operator) {
    throw new Error("The payment's business was not found.");
  }
  return todayInTimeZone(now, operator.timeZone);
}

/** The bond entry for a payment Stripe says succeeded (decision 2): once, for exactly its amount. */
async function addBondReceived(
  tx: AnyTransaction,
  operatorId: string,
  payment: { id: string; rentalId: string; method: StripePaymentMethod; amountCents: number },
  now: Date,
): Promise<void> {
  const [movement] = await tx
    .insert(bondMovements)
    .values({
      operatorId,
      rentalId: payment.rentalId,
      kind: "received",
      amountCents: payment.amountCents,
      method: payment.method,
      occurredOn: await businessToday(tx, operatorId, now),
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
  now: Date,
): Promise<void> {
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
        .for("update");
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
      now,
    );
  }
}

/** What came of a visit to Stripe's page, applied inside the business's own transaction. */
export async function applyCheckoutOutcome(
  tx: AnyTransaction,
  operatorId: string,
  outcome: CheckoutOutcome,
  now: Date,
): Promise<void> {
  const { reference } = outcome;
  if (!outcome.isComplete || !reference) {
    return;
  }
  // The session's account is this business's (rule 3), so its rental must be
  // too; one that is not is ignored, never recorded against anyone.
  const [rental] = await tx
    .select({ id: rentals.id })
    .from(rentals)
    .where(
      and(
        eq(rentals.id, reference.rentalId),
        eq(rentals.operatorId, operatorId),
        eq(rentals.renterId, reference.renterId),
      ),
    );
  if (!rental) {
    return;
  }
  if (reference.purpose === "direct_debit") {
    await recordMandate(tx, operatorId, outcome, now);
    return;
  }
  await recordBondPayment(tx, operatorId, outcome, now);
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
    })
    .from(paymentMandates)
    .where(eq(paymentMandates.stripeMandateId, update.mandateId))
    .for("update");
  const status = mandateStatusOf(update.stripeStatus);
  if (!mandate || mandate.status === "inactive" || mandate.status === status) {
    return;
  }
  await tx
    .update(paymentMandates)
    .set({ ...mandateChange(status, now), updatedAt: now })
    .where(eq(paymentMandates.id, mandate.id));
  await logSystem(tx, operatorId, ACTIVITY_ENTITY_TYPES.paymentMandate, mandate.id, { status });
}
