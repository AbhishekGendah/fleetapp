import type { PaymentLineReason } from "@fleetapp/core";
import { recordActivity } from "@fleetapp/db/activity";
import type { AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  ledgerLines,
  paymentLedgerLines,
} from "@fleetapp/db/schema";
import { and, eq, isNull } from "drizzle-orm";

const SYSTEM_ACTOR = { type: "system", id: null } as const;

/** What a line Stripe's news made says, on the ledger and the Renter's statement. */
export const STRIPE_LINE_DESCRIPTIONS: Readonly<Record<PaymentLineReason, string>> = {
  settled: "Direct debit received",
  refund: "Refunded in Stripe",
  dispute_lost: "Disputed with the Renter's bank: the bank took it back",
  refund_failed: "Stripe could not make this refund, so the money stayed with you",
  dispute_won: "Dispute won: the bank gave it back",
};

const KIND_OF_REASON: Readonly<Record<PaymentLineReason, "payment" | "refund" | "reversal">> = {
  settled: "payment",
  dispute_won: "payment",
  refund: "refund",
  dispute_lost: "refund",
  refund_failed: "reversal",
};

/** A line Stripe's news makes: about which debit, why, and (for a refund or dispute) Stripe's ID. */
export interface StripeLine {
  rentalId: string;
  paymentId: string;
  reason: PaymentLineReason;
  stripeObjectId: string | null;
  amountCents: number;
  /** The business's own day it happened on (rule 10). */
  effectiveOn: string;
  /** For a refund that failed: the refund line it undoes. */
  reversesId?: string;
}

/** The line already made for this debit and reason (and Stripe object), if any. */
export async function stripeLineOf(
  tx: AnyTransaction,
  operatorId: string,
  source: Pick<StripeLine, "paymentId" | "reason" | "stripeObjectId">,
): Promise<string | null> {
  const [link] = await tx
    .select({ lineId: paymentLedgerLines.ledgerLineId })
    .from(paymentLedgerLines)
    .where(
      and(
        eq(paymentLedgerLines.operatorId, operatorId),
        eq(paymentLedgerLines.paymentId, source.paymentId),
        eq(paymentLedgerLines.reason, source.reason),
        source.stripeObjectId === null
          ? isNull(paymentLedgerLines.stripeObjectId)
          : eq(paymentLedgerLines.stripeObjectId, source.stripeObjectId),
      ),
    );
  return link?.lineId ?? null;
}

/**
 * Adds the ledger line Stripe's news makes, and its link to the debit, once
 * (rule 20; the caller holds the rental's lock, so two can't both add it).
 * Only ever added (rule 11). Returns whether it was added now.
 */
export async function addStripeLineOnce(
  tx: AnyTransaction,
  operatorId: string,
  line: StripeLine,
): Promise<boolean> {
  if (await stripeLineOf(tx, operatorId, line)) {
    return false;
  }
  const kind = KIND_OF_REASON[line.reason];
  const [added] = await tx
    .insert(ledgerLines)
    .values({
      operatorId,
      rentalId: line.rentalId,
      kind,
      amountCents: line.amountCents,
      gstCents: 0,
      description: STRIPE_LINE_DESCRIPTIONS[line.reason],
      effectiveOn: line.effectiveOn,
      method: kind === "reversal" ? null : "becs_debit",
      reversesId: line.reversesId ?? null,
    })
    .returning({ id: ledgerLines.id });
  await tx.insert(paymentLedgerLines).values({
    operatorId,
    rentalId: line.rentalId,
    paymentId: line.paymentId,
    ledgerLineId: added!.id,
    reason: line.reason,
    stripeObjectId: line.stripeObjectId,
  });
  await recordActivity(tx, {
    operatorId,
    actor: SYSTEM_ACTOR,
    entityType: ACTIVITY_ENTITY_TYPES.ledgerLine,
    entityId: added!.id,
    action: ACTIVITY_ACTIONS.created,
    valuesAfter: { kind, amountCents: line.amountCents, gstCents: 0, paymentId: line.paymentId },
  });
  return true;
}
