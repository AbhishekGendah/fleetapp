"use server";

import type { StripePaymentMethod } from "@fleetapp/core";
import { notFound, redirect } from "next/navigation";

import { appDb } from "../../../../lib/app-db";
import { standInPayments } from "../../../../lib/payments/app-payments";
import { handlePaymentEvent } from "../../../../lib/payments/payment-accounts";

/**
 * Browser tests only: "Stripe's page" finishes (a direct debit set up, or
 * the bond paid by card or bank debit), Stripe's event arrives signed like
 * the real one, and the Renter is sent back. Or they leave without finishing.
 */
export async function finishStandInCheckoutAction(
  sessionId: string,
  method: StripePaymentMethod | "leave",
): Promise<void> {
  const stripe = standInPayments();
  const checkout = stripe?.checkout(sessionId);
  if (!stripe || !checkout) {
    notFound();
  }
  if (method === "leave") {
    redirect(checkout.request.cancelUrl);
  }
  const event = stripe.finishCheckout(sessionId, method);
  await handlePaymentEvent(
    { database: appDb, payments: stripe, now: () => new Date() },
    event.payload,
    event.signature,
  );
  redirect(checkout.request.successUrl);
}
