import type { BondMovementKind } from "@fleetapp/core";
import { recordActivity } from "@fleetapp/db/activity";
import type { AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  bondMovements,
  payments,
} from "@fleetapp/db/schema";
import { and, eq } from "drizzle-orm";

import { businessDayOf } from "./business-day";
import type { MoneyTakenBack } from "./payments-provider";

const SYSTEM_ACTOR = { type: "system", id: null } as const;
/** Why each entry from Stripe was made, as the bond card shows it (kept for the business). */
const NOTES = {
  refunded: "Refunded in Stripe.",
  disputed: "Disputed with the Renter's bank: the bank took it back.",
  refundFailed: "Stripe could not make this refund, so the money stayed with you.",
  disputeWon: "Dispute won: the bank gave it back.",
} as const;

/** The bond payment a refund or dispute is about, or null if it is not one of this business's bonds. */
/** A bond payment through Stripe, as a refund or dispute needs it. */
export interface BondPaymentRef {
  id: string;
  rentalId: string;
  method: string;
  purpose: string;
}

export async function bondPaymentOf(
  tx: AnyTransaction,
  operatorId: string,
  paymentIntentId: string,
): Promise<BondPaymentRef | null> {
  const [payment] = await tx
    .select({
      id: payments.id,
      rentalId: payments.rentalId,
      method: payments.method,
      purpose: payments.purpose,
    })
    .from(payments)
    .where(
      and(eq(payments.operatorId, operatorId), eq(payments.stripePaymentIntentId, paymentIntentId)),
    );
  return payment?.purpose === "bond" ? payment : null;
}

type BondEntry = {
  rentalId: string;
  kind: BondMovementKind;
  amountCents: number;
  method: "card" | "becs_debit" | null;
  paymentId: string | null;
  reversesId: string | null;
  note: string;
  occurredOn: string;
};

/** Adds an entry from Stripe once, by the Stripe object it came from (rule 20), and logs it. */
async function addEntryOnce(
  tx: AnyTransaction,
  operatorId: string,
  source: Pick<MoneyTakenBack, "objectId" | "kind">,
  entry: BondEntry,
): Promise<void> {
  const [added] = await tx
    .insert(bondMovements)
    .values({
      operatorId,
      stripeObjectId: source.objectId,
      stripeObjectKind: source.kind,
      ...entry,
    })
    .onConflictDoNothing({ target: [bondMovements.stripeObjectId, bondMovements.kind] })
    .returning({ id: bondMovements.id });
  if (added) {
    await recordActivity(tx, {
      operatorId,
      actor: SYSTEM_ACTOR,
      entityType: ACTIVITY_ENTITY_TYPES.bondMovement,
      entityId: added.id,
      action: ACTIVITY_ACTIONS.created,
      valuesAfter: {
        rentalId: entry.rentalId,
        kind: entry.kind,
        amountCents: entry.amountCents,
        method: entry.method,
      },
    });
  }
}

/** A refund Stripe couldn't make: the entry that took it off the bond is cancelled out. */
async function undoFailedRefund(
  tx: AnyTransaction,
  operatorId: string,
  takenBack: MoneyTakenBack,
  occurredOn: string,
): Promise<void> {
  const [refunded] = await tx
    .select({ id: bondMovements.id, rentalId: bondMovements.rentalId })
    .from(bondMovements)
    .where(
      and(
        eq(bondMovements.operatorId, operatorId),
        eq(bondMovements.stripeObjectId, takenBack.objectId),
        eq(bondMovements.kind, "refunded"),
      ),
    );
  if (!refunded) {
    return;
  }
  await addEntryOnce(tx, operatorId, takenBack, {
    rentalId: refunded.rentalId,
    kind: "reversal",
    amountCents: takenBack.amountCents,
    method: null,
    paymentId: null,
    reversesId: refunded.id,
    note: NOTES.refundFailed,
    occurredOn,
  });
}

/**
 * Money a bond payment through Stripe lost or got back, as Stripe says
 * (review A5-4): a refund made in the business's Stripe dashboard, a
 * dispute with the Renter's bank, a refund that failed, or a dispute won.
 * Each is a new bond entry, never a change (rule 11), added once.
 */
export async function applyMoneyTakenBack(
  tx: AnyTransaction,
  operatorId: string,
  takenBack: MoneyTakenBack,
  occurredAt: Date,
): Promise<void> {
  const payment = takenBack.paymentIntentId
    ? await bondPaymentOf(tx, operatorId, takenBack.paymentIntentId)
    : null;
  if (!payment) {
    return;
  }
  const occurredOn = await businessDayOf(tx, operatorId, occurredAt);
  if (takenBack.status === "failed") {
    await undoFailedRefund(tx, operatorId, takenBack, occurredOn);
    return;
  }
  const isDispute = takenBack.kind === "dispute";
  const isReturned = takenBack.status === "returned";
  await addEntryOnce(tx, operatorId, takenBack, {
    rentalId: payment.rentalId,
    kind: isReturned ? "received" : "refunded",
    amountCents: takenBack.amountCents,
    method: payment.method === "card" ? "card" : "becs_debit",
    paymentId: payment.id,
    reversesId: null,
    note: isReturned ? NOTES.disputeWon : isDispute ? NOTES.disputed : NOTES.refunded,
    occurredOn,
  });
}
