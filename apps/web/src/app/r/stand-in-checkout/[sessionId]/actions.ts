"use server";

import {
  STRIPE_ID_PATTERNS,
  STRIPE_PAYMENT_METHODS,
  type StripePaymentMethod,
} from "@fleetapp/core";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { appDb } from "../../../../lib/app-db";
import { standInPayments } from "../../../../lib/payments/app-payments";
import { handlePaymentEvent } from "../../../../lib/payments/payment-accounts";

/**
 * Browser tests only: "Stripe's page" finishes (a direct debit set up, or
 * the bond paid by card or bank debit), Stripe's event arrives signed like
 * the real one, and the Renter is sent back. Or they leave without finishing.
 */
const LEAVE = "leave";
/** What the stand-in's buttons send, checked as every action's input is (review A5-11). */
const finishInputSchema = z.object({
  sessionId: z.string().regex(STRIPE_ID_PATTERNS.checkoutSession),
  method: z.enum([...STRIPE_PAYMENT_METHODS, LEAVE]),
});

export async function finishStandInCheckoutAction(
  sessionIdInput: string,
  methodInput: StripePaymentMethod | typeof LEAVE,
): Promise<void> {
  const parsed = finishInputSchema.safeParse({ sessionId: sessionIdInput, method: methodInput });
  if (!parsed.success) {
    notFound();
  }
  const { sessionId, method } = parsed.data;
  const stripe = standInPayments();
  const checkout = stripe?.checkout(sessionId);
  if (!stripe || !checkout) {
    notFound();
  }
  if (method === LEAVE) {
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
