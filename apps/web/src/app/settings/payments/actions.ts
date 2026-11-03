"use server";

import { describeErrorForLog } from "@fleetapp/core";
import { failedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";
import { redirect } from "next/navigation";

import { appDb } from "../../../lib/app-db";
import { appPayments } from "../../../lib/payments/app-payments";
import { startStripeOnboarding } from "../../../lib/payments/payment-accounts";
import { onboardingUrls } from "../../../lib/payments/payment-urls";
import { requireUser } from "../../../lib/require-user";

const NOT_SET_UP_MESSAGE = "Payments by Stripe are not set up on this site yet.";
const FAILED_MESSAGE = "Stripe could not be reached. Try again in a minute.";

/** Makes the business's Stripe account the first time, then opens Stripe's own onboarding. */
export async function connectStripeAction(_previous: ChangeFormState): Promise<ChangeFormState> {
  const user = await requireUser();
  if (!appPayments) {
    return failedState(NOT_SET_UP_MESSAGE);
  }
  let url: string;
  try {
    url = await startStripeOnboarding(
      { database: appDb, payments: appPayments, now: () => new Date() },
      { userId: user.id, operatorId: user.operatorId },
      onboardingUrls(),
    );
  } catch (error) {
    console.error("Starting Stripe onboarding failed", describeErrorForLog(error));
    return failedState(FAILED_MESSAGE);
  }
  // Outside the try: redirect works by throwing, and must not be caught as a failure.
  redirect(url);
}
