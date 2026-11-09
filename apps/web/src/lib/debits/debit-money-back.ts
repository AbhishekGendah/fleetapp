import type { PaymentLineReason } from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";

import type { MoneyTakenBack } from "../payments/payments-provider";
import { addStripeLineOnce, stripeLineOf } from "./stripe-ledger-lines";

/** Why money back adds its line: a refund or dispute taken, a refund failed, a dispute won. */
function reasonOf(takenBack: MoneyTakenBack): PaymentLineReason {
  if (takenBack.status === "failed") {
    return "refund_failed";
  }
  if (takenBack.status === "returned") {
    return "dispute_won";
  }
  return takenBack.kind === "dispute" ? "dispute_lost" : "refund";
}

/**
 * Money a debit lost or got back, as Stripe says, on the ledger (decision
 * 8), the rental already locked by the caller: a refund or a dispute lost
 * adds a refund line of the amount Stripe moved (the bank can take a
 * different amount from the debit, after a part refund, so never a
 * reversal of the payment); a refund that failed reverses its refund line;
 * a dispute won adds a payment line. The debit's own status is unchanged:
 * the lines say what moved. Each once per Stripe object (rule 20).
 */
export async function applyDebitMoneyBack(
  tx: AnyTransaction,
  operatorId: string,
  debit: { id: string; rentalId: string; takenBack: MoneyTakenBack; occurredOn: string },
): Promise<string | null> {
  const { takenBack } = debit;
  const reason = reasonOf(takenBack);
  const source = { paymentId: debit.id, stripeObjectId: takenBack.objectId };
  const refundLineId =
    reason === "refund_failed"
      ? await stripeLineOf(tx, operatorId, { ...source, reason: "refund" })
      : null;
  if (reason === "refund_failed" && !refundLineId) {
    // Never on the ledger, so nothing to undo.
    return null;
  }
  const isAdded = await addStripeLineOnce(tx, operatorId, {
    ...source,
    rentalId: debit.rentalId,
    reason,
    amountCents: takenBack.amountCents,
    effectiveOn: debit.occurredOn,
    ...(refundLineId ? { reversesId: refundLineId } : {}),
  });
  return isAdded ? debit.rentalId : null;
}
