import "server-only";

import { env } from "../../env";
import { appDb } from "../app-db";
import { billingDependencies } from "../billing/billing-dependencies";
import { issuePendingDocumentsQuietly } from "../billing/billing-run";
import type { PaymentDependencies } from "./payment-accounts";
import { appPayments } from "./app-payments-provider";
import type { StandInPayments } from "./stand-in-provider";

export { appPayments };

/**
 * Whether Renters can be sent to Stripe's page: only once we can hear back
 * about the business's own account (its event destination's secret is set).
 * The stand-in signs every event with the one secret.
 */
export const canHearRenterPayments: boolean =
  env.PAYMENTS_TRANSPORT === "stand_in" ||
  (env.PAYMENTS_TRANSPORT === "stripe" && Boolean(env.STRIPE_CONNECT_WEBHOOK_SECRET));

/** The browser tests' stand-in, when this site runs on it. */
export function standInPayments(): StandInPayments | null {
  return env.PAYMENTS_TRANSPORT === "stand_in" ? (appPayments as StandInPayments) : null;
}

/**
 * What the payments code needs on this site; null while payments by Stripe
 * are not set up. A debit that cleared (or a refund) gets its receipt at once.
 */
export function appPaymentDependencies(): PaymentDependencies | null {
  return appPayments
    ? {
        database: appDb,
        payments: appPayments,
        now: () => new Date(),
        afterLedgerLines: async (operatorId, rentalId) => {
          await issuePendingDocumentsQuietly(billingDependencies(), { operatorId }, rentalId);
        },
      }
    : null;
}
