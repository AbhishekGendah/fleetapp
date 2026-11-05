"use server";

import { describeErrorForLog, formTextValues, SIGN_CONTRACT_FIELDS } from "@fleetapp/core";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { env } from "../../../env";

import { appDb } from "../../../lib/app-db";
import { signContract, type SignContractResult } from "../../../lib/contracts/signing";
import { appEmailSender } from "../../../lib/email-sender";
import { fileDependencies } from "../../../lib/files/file-action-support";
import { appPaymentsLinkDependencies } from "../../../lib/payments/app-payments-links";
import { continueToPayments } from "../../../lib/payments/payments-links";
import { openLink, openVerifiedLink, type LinkVisit } from "../../../lib/renter-links/link-visits";
import { requestMetaFrom } from "../../../lib/request-meta";
import { DEVICE_COOKIE, linkPagePath } from "./link-state";
import type { SignState } from "./signing-state";

const SIGNING_PURPOSES = ["sign_contract", "sign_change"] as const;
const SHUT_MESSAGE = "This link no longer works. Ask the business that sent it for a new one.";
const FAILED_MESSAGE = "Something went wrong, so it is not signed yet. Try again in a moment.";

const NOT_SIGNED_MESSAGES: Record<
  Exclude<SignContractResult["status"], "signed" | "invalid">,
  string
> = {
  signed_already: "This is already signed. A copy was emailed to you.",
  changed:
    "This has changed since the page was opened, so it was not signed. Reload the page to read it again.",
  not_signable: SHUT_MESSAGE,
};

function signState(result: SignContractResult): SignState {
  if (result.status === "signed") {
    return {
      status: "signed",
      signedAtText: result.signedAtText,
      isCopyEmailed: result.isCopyEmailed,
      paymentsNext: null,
    };
  }
  if (result.status === "invalid") {
    const firstMessage = Object.values(result.fieldErrors).find((messages) => messages?.length);
    return { status: "problem", message: firstMessage?.[0] ?? FAILED_MESSAGE };
  }
  return { status: "problem", message: NOT_SIGNED_MESSAGES[result.status] };
}

/**
 * Bound to the link's secret by its page. Signs only for a phone that has
 * passed the code, and only the exact text the page showed.
 */
export async function signContractAction(
  token: string,
  _previous: SignState,
  formData: FormData,
): Promise<SignState> {
  try {
    const deviceToken = (await cookies()).get(DEVICE_COOKIE)?.value;
    const visit = await openVerifiedLink(appDb, token, deviceToken, SIGNING_PURPOSES);
    if (!visit) {
      return { status: "problem", message: SHUT_MESSAGE };
    }
    const result = await signContract(
      { ...fileDependencies(), emailSender: appEmailSender },
      visit,
      formTextValues(formData, SIGN_CONTRACT_FIELDS),
      requestMetaFrom(await headers()),
    );
    const state = signState(result);
    return state.status === "signed" ? { ...state, paymentsNext: await carryOn(visit) } : state;
  } catch (error) {
    // Never the error's details: they could hold the Renter's name or the link.
    console.error("Signing a contract failed", describeErrorForLog(error));
    return { status: "problem", message: FAILED_MESSAGE };
  }
}

/**
 * Once signed, the Renter carries on to their direct debit and bond, if
 * the business takes payments by Stripe and either is still to do. This
 * phone gets a pass for the new link, so no second code; it is set as the
 * link's cookie only when they press on (setting it here would reload the
 * page, whose signing link is now used up). A failure here leaves the
 * signing done: the payments link can be sent from the rental.
 */
async function carryOn(visit: LinkVisit): Promise<{ token: string; deviceToken: string } | null> {
  try {
    const next = await continueToPayments(appPaymentsLinkDependencies(visit.timeZone), visit);
    return next ? { token: next.token, deviceToken: next.deviceToken } : null;
  } catch (error) {
    console.error("Carrying on to payments after signing failed", describeErrorForLog(error));
    return null;
  }
}

/**
 * The Renter presses on to their payments link: this phone's pass is kept
 * as the link's cookie, and they go there. A pass that is not the link's
 * own does nothing: the link then asks for a code as usual.
 */
export async function goToPaymentsAction(token: string, deviceToken: string): Promise<void> {
  const visit = await openLink(appDb, token);
  if (visit) {
    (await cookies()).set(DEVICE_COOKIE, deviceToken, {
      httpOnly: true,
      secure: new URL(env.APP_URL).protocol === "https:",
      sameSite: "lax",
      path: linkPagePath(token),
      expires: visit.expiresAt,
    });
  }
  // Outside any try: Next carries out a redirect by throwing.
  redirect(linkPagePath(token));
}
