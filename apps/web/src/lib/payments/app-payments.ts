import "server-only";

import { env } from "../../env";
import type { PaymentsProvider } from "./payments-provider";
import { createStandInPayments, type StandInPayments } from "./stand-in-provider";
import { createStripeProvider } from "./stripe-provider";

function paymentsForThisSite(): PaymentsProvider | null {
  if (env.PAYMENTS_TRANSPORT === "stripe") {
    // Both are required with "stripe" by the env check at start-up.
    return createStripeProvider(env.STRIPE_SECRET_KEY ?? "", env.STRIPE_WEBHOOK_SECRET ?? "");
  }
  if (env.PAYMENTS_TRANSPORT === "stand_in") {
    return createStandInPayments(env.STRIPE_WEBHOOK_SECRET ?? "");
  }
  return null;
}

/** The app's way to Stripe; null while payments by Stripe are not set up on this site. */
export const appPayments: PaymentsProvider | null = paymentsForThisSite();

/** The browser tests' stand-in, when this site runs on it. */
export function standInPayments(): StandInPayments | null {
  return env.PAYMENTS_TRANSPORT === "stand_in" ? (appPayments as StandInPayments) : null;
}
