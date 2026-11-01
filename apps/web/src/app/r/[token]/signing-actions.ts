"use server";

import { describeErrorForLog, formTextValues, SIGN_CONTRACT_FIELDS } from "@fleetapp/core";
import { cookies, headers } from "next/headers";

import { appDb } from "../../../lib/app-db";
import { signContract, type SignContractResult } from "../../../lib/contracts/signing";
import { appEmailSender } from "../../../lib/email-sender";
import { fileDependencies } from "../../../lib/files/file-action-support";
import { openVerifiedLink } from "../../../lib/renter-links/link-visits";
import { requestMetaFrom } from "../../../lib/request-meta";
import { DEVICE_COOKIE } from "./link-state";
import type { SignState } from "./signing-state";

const SHUT_MESSAGE = "This link no longer works. Ask the business that sent it for a new one.";
const FAILED_MESSAGE = "Something went wrong, so it is not signed yet. Try again in a moment.";

const NOT_SIGNED_MESSAGES: Record<
  Exclude<SignContractResult["status"], "signed" | "invalid">,
  string
> = {
  signed_already: "This contract is already signed. A copy was emailed to you.",
  changed:
    "The contract has changed since this page was opened, so it was not signed. Reload the page to read it again.",
  not_signable: SHUT_MESSAGE,
};

function signState(result: SignContractResult): SignState {
  if (result.status === "signed") {
    return { status: "signed", signedAtText: result.signedAtText };
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
    const visit = await openVerifiedLink(appDb, token, deviceToken, "sign_contract");
    if (!visit) {
      return { status: "problem", message: SHUT_MESSAGE };
    }
    const result = await signContract(
      { ...fileDependencies(), emailSender: appEmailSender },
      visit,
      formTextValues(formData, SIGN_CONTRACT_FIELDS),
      requestMetaFrom(await headers()),
    );
    return signState(result);
  } catch (error) {
    // Never the error's details: they could hold the Renter's name or the link.
    console.error("Signing a contract failed", describeErrorForLog(error));
    return { status: "problem", message: FAILED_MESSAGE };
  }
}
