"use server";

import { describeErrorForLog, typedLinkCode } from "@fleetapp/core";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { env } from "../../../env";
import { appDb } from "../../../lib/app-db";
import { appEmailSender } from "../../../lib/email-sender";
import { checkLinkCode, openLink, sendLinkCode } from "../../../lib/renter-links/link-visits";
import { DEVICE_COOKIE, linkPagePath, type CodeStepState } from "./link-state";

const GONE_MESSAGE = "This link no longer works. Ask the business that sent it for a new one.";
const LOCKED_MESSAGE =
  "Too many wrong codes, so this link is locked. Ask the business that sent it for a new one.";
const TOO_MANY_MESSAGE = "We have sent 3 codes in the last hour. Use the latest one, or try later.";
const EXPIRED_CODE_MESSAGE = "That code has run out. Press Email me a code for a new one.";
const FAILED_MESSAGE = "Something went wrong. Try again in a moment.";

/** Bound to the link's secret by its page. Emails a fresh code to the address the link went to. */
export async function sendCodeAction(
  token: string,
  _previous: CodeStepState,
): Promise<CodeStepState> {
  try {
    const visit = await openLink(appDb, token);
    if (!visit) {
      return { status: "problem", message: GONE_MESSAGE };
    }
    const result = await sendLinkCode(
      { database: appDb, emailSender: appEmailSender, now: () => new Date() },
      visit,
    );
    if (result === "locked") {
      return { status: "problem", message: LOCKED_MESSAGE };
    }
    return result === "too_many"
      ? { status: "problem", message: TOO_MANY_MESSAGE }
      : { status: "code_sent" };
  } catch (error) {
    // Never the error's details or the address: both could hold the secret.
    console.error("Sending a link code failed", describeErrorForLog(error));
    return { status: "problem", message: FAILED_MESSAGE };
  }
}

/** Checks the typed code; when right, remembers this phone for the link and shows the form. */
export async function checkCodeAction(
  token: string,
  _previous: CodeStepState,
  formData: FormData,
): Promise<CodeStepState> {
  const typed = formData.get("code");
  let deviceToken: string;
  let expiresAt: Date;
  try {
    const visit = await openLink(appDb, token);
    if (!visit) {
      return { status: "problem", message: GONE_MESSAGE };
    }
    const result = await checkLinkCode(
      { database: appDb, now: () => new Date() },
      visit,
      typedLinkCode(typeof typed === "string" ? typed : ""),
    );
    if (result.status === "locked") {
      return { status: "problem", message: LOCKED_MESSAGE };
    }
    if (result.status === "expired") {
      return { status: "problem", message: EXPIRED_CODE_MESSAGE };
    }
    if (result.status === "wrong") {
      return {
        status: "problem",
        message: `That code is not right. ${result.triesLeft} ${result.triesLeft === 1 ? "try" : "tries"} left.`,
      };
    }
    deviceToken = result.deviceToken;
    expiresAt = visit.expiresAt;
  } catch (error) {
    console.error("Checking a link code failed", describeErrorForLog(error));
    return { status: "problem", message: FAILED_MESSAGE };
  }
  (await cookies()).set(DEVICE_COOKIE, deviceToken, {
    httpOnly: true,
    secure: new URL(env.APP_URL).protocol === "https:",
    sameSite: "lax",
    path: linkPagePath(token),
    expires: expiresAt,
  });
  // Outside the try: Next carries out a redirect by throwing.
  redirect(linkPagePath(token));
}
