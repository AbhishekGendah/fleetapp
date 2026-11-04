"use server";

import { CHECKOUT_PURPOSES, describeErrorForLog, type CheckoutPurpose } from "@fleetapp/core";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { appDb } from "../../../lib/app-db";
import { appPaymentsLinkDependencies } from "../../../lib/payments/app-payments-links";
import {
  startRenterCheckout,
  type StartCheckoutResult,
} from "../../../lib/payments/renter-checkout";
import { TOO_MANY_TRIES_MESSAGE } from "../../../lib/renter-links/link-limits";
import { openVerifiedLink } from "../../../lib/renter-links/link-visits";
import { DEVICE_COOKIE } from "./link-state";

/** What pressing a payment button came back with, when it did not go to Stripe's page. */
export type CheckoutState = { status: "idle" } | { status: "problem"; message: string };

const NOT_STARTED_MESSAGES: Readonly<
  Record<Exclude<StartCheckoutResult["status"], "started">, string>
> = {
  not_offered:
    "Payments are not being taken online right now. The business will tell you how to pay.",
  not_found: "This link no longer works. Ask the business that sent it for a new one.",
  nothing_owing: "Nothing is owing on the bond now.",
  too_many: TOO_MANY_TRIES_MESSAGE,
  just_paid:
    "A bond payment you started has just gone through. Reload this page to see what is left.",
};
const FAILED_MESSAGE = "Stripe's page could not be opened. Try again in a moment.";

/**
 * Bound to the link's secret and what it is for by its page: sends this
 * phone (only one that passed the code) to Stripe's own page.
 */
export async function startCheckoutAction(
  token: string,
  purpose: CheckoutPurpose,
  _previous: CheckoutState,
): Promise<CheckoutState> {
  if (!CHECKOUT_PURPOSES.includes(purpose)) {
    return { status: "problem", message: NOT_STARTED_MESSAGES.not_found };
  }
  let url: string;
  try {
    const deviceToken = (await cookies()).get(DEVICE_COOKIE)?.value;
    const visit = await openVerifiedLink(appDb, token, deviceToken, "set_up_payments");
    if (!visit) {
      return { status: "problem", message: NOT_STARTED_MESSAGES.not_found };
    }
    const result = await startRenterCheckout(
      appPaymentsLinkDependencies(visit.timeZone),
      visit,
      purpose,
    );
    if (result.status !== "started") {
      return { status: "problem", message: NOT_STARTED_MESSAGES[result.status] };
    }
    url = result.url;
  } catch (error) {
    // Never the error's details: they could hold the link or the Renter's name.
    console.error("Starting Stripe's page failed", describeErrorForLog(error));
    return { status: "problem", message: FAILED_MESSAGE };
  }
  // Outside the try: Next carries out a redirect by throwing.
  redirect(url);
}
