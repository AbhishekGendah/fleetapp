import "server-only";

import { env } from "../../env";
import type { PaymentsProvider } from "./payments-provider";
import { createStandInPayments, type StandInPayments } from "./stand-in-provider";
import { createStripeProvider } from "./stripe-provider";

function paymentsForThisSite(): PaymentsProvider | null {
  if (env.PAYMENTS_TRANSPORT === "stripe") {
    // Both are required with "stripe" by the env check at start-up.
    const secrets = [env.STRIPE_WEBHOOK_SECRET, env.STRIPE_CONNECT_WEBHOOK_SECRET];
    return createStripeProvider(
      env.STRIPE_SECRET_KEY ?? "",
      secrets.filter((secret): secret is string => Boolean(secret)),
    );
  }
  if (env.PAYMENTS_TRANSPORT === "stand_in") {
    return createStandInPayments(env.STRIPE_WEBHOOK_SECRET ?? "");
  }
  return null;
}

/** The app's way to Stripe; null while payments by Stripe are not set up on this site. */
export const appPayments: PaymentsProvider | null = paymentsForThisSite();

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
