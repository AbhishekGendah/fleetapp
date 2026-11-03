"use server";

import { describeErrorForLog, isRecordId } from "@fleetapp/core";
import { revalidatePath } from "next/cache";

import { appPaymentsLinkDependencies } from "../../../lib/payments/app-payments-links";
import {
  sendPaymentsLink,
  type PaymentsLinkDelivery,
  type SendPaymentsLinkResult,
} from "../../../lib/payments/payments-links";
import { rentalPath } from "../../../lib/paths";
import { linkSentState, type LinkSendState } from "../../../lib/renter-links/link-send-state";
import { requireUser } from "../../../lib/require-user";

const NOT_SENT_MESSAGES: Readonly<
  Record<Exclude<SendPaymentsLinkResult["status"], "sent">, string>
> = {
  not_offered: "Payments by Stripe are not ready yet. Check Settings → Payments.",
  not_found: "That rental could not be found, or it is closed.",
  no_email:
    "The Renter has no email on file, and the one-time code goes there. Add one on their page.",
};
const FAILED_MESSAGE = "The link could not be made. Try again in a moment.";

async function makePaymentsLink(
  rentalId: string,
  delivery: PaymentsLinkDelivery,
): Promise<LinkSendState> {
  const user = await requireUser();
  if (!isRecordId(rentalId)) {
    return { status: "failed", message: NOT_SENT_MESSAGES.not_found };
  }
  try {
    const result = await sendPaymentsLink(
      appPaymentsLinkDependencies(user.operatorTimezone),
      { userId: user.id, operatorId: user.operatorId },
      rentalId,
      delivery,
    );
    revalidatePath(rentalPath(rentalId));
    return result.status === "sent"
      ? linkSentState(result, user.operatorTimezone)
      : { status: "failed", message: NOT_SENT_MESSAGES[result.status] };
  } catch (error) {
    // Never the error's details: they could hold the link's address.
    console.error("Making a payments link failed", describeErrorForLog(error));
    return { status: "failed", message: FAILED_MESSAGE };
  }
}

/** Emails the Renter the link to set up their direct debit and pay the bond. */
export async function emailPaymentsLinkAction(
  rentalId: string,
  _previous: LinkSendState,
): Promise<LinkSendState> {
  return makePaymentsLink(rentalId, "email");
}

/** The same link, shown as a code for the Renter to scan on the spot. */
export async function showPaymentsLinkAction(
  rentalId: string,
  _previous: LinkSendState,
): Promise<LinkSendState> {
  return makePaymentsLink(rentalId, "on_the_spot");
}
