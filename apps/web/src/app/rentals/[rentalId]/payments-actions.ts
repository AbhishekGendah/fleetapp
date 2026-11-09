"use server";

import { describeErrorForLog, formTextValues, isRecordId } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";
import { revalidatePath } from "next/cache";

import { appDb } from "../../../lib/app-db";
import { setDebitsPaused } from "../../../lib/debits/debit-pause";
import { REVERSAL_FIELDS, reversalInputSchema } from "../../../lib/ledger/ledger-input";
import { appPaymentsLinkDependencies } from "../../../lib/payments/app-payments-links";
import {
  sendPaymentsLink,
  type PaymentsLinkDelivery,
  type SendPaymentsLinkResult,
} from "../../../lib/payments/payments-links";
import { rentalPath } from "../../../lib/paths";
import { cancelRentalLink } from "../../../lib/renter-links/cancel-links";
import { linkSentState, type LinkSendState } from "../../../lib/renter-links/link-send-state";
import { requireUser } from "../../../lib/require-user";
import { RENTER_ARCHIVED_MESSAGE } from "../../../lib/renters/renter-archived";
import { runUserChange } from "../../../lib/run-change";

const NOT_SENT_MESSAGES: Readonly<
  Record<Exclude<SendPaymentsLinkResult["status"], "sent">, string>
> = {
  not_offered: "Payments by Stripe are not ready yet. Check Settings → Payments.",
  not_found: "That rental could not be found, or it is closed.",
  no_email:
    "The Renter has no email on file, and the one-time code goes there. Add one on their page.",
  renter_archived: RENTER_ARCHIVED_MESSAGE,
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

/** Stops the payments link working, emailed or shown as a code (review A3-3). */
export async function cancelPaymentsLinkAction(
  rentalId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (!isRecordId(rentalId)) {
    return failedState(NOT_SENT_MESSAGES.not_found);
  }
  return runUserChange({
    description: "Cancelling a payments link",
    pagesToRefresh: [rentalPath(rentalId)],
    change: async (actor) =>
      (await cancelRentalLink(
        appDb,
        actor,
        { rentalId, purpose: "set_up_payments" },
        new Date(),
      )) === "cancelled"
        ? savedState("Link cancelled.")
        : failedState("There is no link to cancel."),
  });
}

/** Bound to one rental: pauses its automatic debits, with why (kept for the business). */
export async function pauseDebitsAction(
  rentalId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = reversalInputSchema.safeParse(formTextValues(formData, REVERSAL_FIELDS));
  if (!isRecordId(rentalId) || !parsed.success) {
    return failedState("Say why automatic debits are paused, then try again.");
  }
  return runUserChange({
    description: "Pausing automatic debits",
    pagesToRefresh: [rentalPath(rentalId)],
    change: async (actor) => {
      const result = await setDebitsPaused(appDb, actor, rentalId, { reason: parsed.data.note });
      return result === "not_found"
        ? failedState(NOT_SENT_MESSAGES.not_found)
        : savedState("Automatic debits paused. Charges and invoices carry on as usual.");
    },
  });
}

/** Bound to one rental: resumes its automatic debits, from the next rent week. */
export async function resumeDebitsAction(rentalId: string): Promise<void> {
  const user = await requireUser();
  if (isRecordId(rentalId)) {
    await setDebitsPaused(appDb, { userId: user.id, operatorId: user.operatorId }, rentalId, null);
  }
  revalidatePath(rentalPath(rentalId));
}
