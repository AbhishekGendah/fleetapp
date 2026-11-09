import { debitDescription, describeErrorForLog } from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";
import {
  operators,
  paymentMandates,
  payments,
  rentals,
  renterStripeCustomers,
  vehicles,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq } from "drizzle-orm";

import { loadPaymentAccount, type PaymentDependencies } from "../payments/payment-accounts";
import type { DebitAnswer, DebitRequest } from "../payments/payments-provider";
import { applyDebitRead, failReservedDebit } from "./debit-outcome";
import type { ReservedDebit } from "./debit-reserve";

/** What came of asking Stripe for a debit. */
export type DebitSendResult = "sent" | "refused" | "no_answer" | "not_sendable";

/**
 * What Stripe is asked for, from our reserved row: the Renter's customer,
 * the direct debit's bank account and mandate, the amount, and a
 * description naming the car and the week, never a person (decision 9).
 */
async function debitRequestOf(
  tx: AnyTransaction,
  operatorId: string,
  paymentId: string,
): Promise<DebitRequest | null> {
  const [row] = await tx
    .select({
      amountCents: payments.amountCents,
      periodStartsAt: payments.periodStartsAt,
      requestedAt: payments.requestedAt,
      paymentMethodId: paymentMandates.stripePaymentMethodId,
      mandateId: paymentMandates.stripeMandateId,
      customerId: renterStripeCustomers.stripeCustomerId,
      rego: vehicles.rego,
      timeZone: operators.timezone,
    })
    .from(payments)
    .innerJoin(paymentMandates, eq(paymentMandates.id, payments.mandateId))
    .innerJoin(
      renterStripeCustomers,
      and(
        eq(renterStripeCustomers.renterId, payments.renterId),
        eq(renterStripeCustomers.operatorId, payments.operatorId),
      ),
    )
    .innerJoin(
      rentals,
      and(eq(rentals.id, payments.rentalId), eq(rentals.operatorId, payments.operatorId)),
    )
    .innerJoin(
      vehicles,
      and(eq(vehicles.id, rentals.vehicleId), eq(vehicles.operatorId, rentals.operatorId)),
    )
    .innerJoin(operators, eq(operators.id, payments.operatorId))
    .where(and(eq(payments.operatorId, operatorId), eq(payments.id, paymentId)));
  if (!row?.requestedAt) {
    return null;
  }
  const debit = row.periodStartsAt
    ? ({ kind: "rent", weekStartsAt: row.periodStartsAt } as const)
    : ({ kind: "one_off", requestedAt: row.requestedAt } as const);
  return {
    paymentId,
    customerId: row.customerId,
    paymentMethodId: row.paymentMethodId,
    mandateId: row.mandateId,
    amountCents: row.amountCents,
    description: debitDescription(debit, row.rego, row.timeZone),
  };
}

/** Stripe's answer, or null when none came (logged by our IDs only, rule 7). */
async function askStripe(
  deps: PaymentDependencies,
  accountId: string,
  request: DebitRequest,
  operatorId: string,
): Promise<DebitAnswer | null> {
  try {
    return await deps.payments.createDebit(accountId, request);
  } catch (error) {
    console.error("Stripe gave no answer to a debit request", {
      operatorId,
      paymentId: request.paymentId,
      ...describeErrorForLog(error),
    });
    return null;
  }
}

/**
 * Asks Stripe for a reserved debit, after the transaction that reserved it
 * (Stripe is never waited on with rows locked), with `debit:{paymentId}` as
 * its key, so asking again is the same request. Stripe's answer is saved
 * in a second short transaction, the rental locked first: its ID and
 * pending, or failed with Stripe's reason. No answer leaves the row
 * reserved for the run's recovery; it is never marked failed on a guess.
 */
export async function sendReservedDebit(
  deps: PaymentDependencies,
  operatorId: string,
  debit: ReservedDebit,
): Promise<DebitSendResult> {
  const account = await loadPaymentAccount(deps.database, operatorId);
  const request = await withTenant(deps.database, operatorId, (tx) =>
    debitRequestOf(tx, operatorId, debit.id),
  );
  if (!account || account.state === "disconnected" || !request) {
    return "not_sendable";
  }
  const sent = await askStripe(deps, account.stripeAccountId, request, operatorId);
  if (!sent) {
    return "no_answer";
  }
  const rentalWithLine = await withTenant(deps.database, operatorId, async (tx) => {
    if (sent.status === "refused") {
      await failReservedDebit(tx, operatorId, debit, sent, deps.now());
      return null;
    }
    return applyDebitRead(tx, operatorId, sent.debit, { now: deps.now(), occurredAt: deps.now() });
  });
  if (rentalWithLine) {
    await deps.afterLedgerLines?.(operatorId, rentalWithLine);
  }
  return sent.status;
}
