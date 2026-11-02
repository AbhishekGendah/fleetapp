"use server";

import { describeErrorForLog, isRecordId } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";
import { revalidatePath } from "next/cache";

import { appDb } from "../../../lib/app-db";
import { signingLinkNotSentState } from "../../../lib/contracts/signing-link-messages";
import { cancelSigningLink, sendSigningLink } from "../../../lib/contracts/signing-links";
import { rentalPath } from "../../../lib/paths";
import { appLinkDependencies } from "../../../lib/renter-links/app-link-dependencies";
import { linkSentState, type LinkSendState } from "../../../lib/renter-links/link-send-state";
import { requireUser } from "../../../lib/require-user";
import { runUserChange } from "../../../lib/run-change";

const NOT_FOUND_MESSAGE = "That rental could not be found.";
const SEND_FAILED_MESSAGE = "The contract could not be sent. Try again in a moment.";

/** Sends (or sends again) the contract to the Renter to sign; any older signing link stops working. */
export async function sendSigningLinkAction(
  rentalId: string,
  _previous: LinkSendState,
): Promise<LinkSendState> {
  const user = await requireUser();
  if (!isRecordId(rentalId)) {
    return { status: "failed", message: NOT_FOUND_MESSAGE };
  }
  try {
    const result = await sendSigningLink(
      appLinkDependencies(user.operatorTimezone),
      { userId: user.id, operatorId: user.operatorId },
      rentalId,
      { timeZone: user.operatorTimezone, now: new Date() },
    );
    revalidatePath(rentalPath(rentalId));
    return result.status === "sent"
      ? linkSentState(result, user.operatorTimezone)
      : signingLinkNotSentState(result, "contract");
  } catch (error) {
    // Never the error's details: they could hold the link's address.
    console.error("Sending a signing link failed", describeErrorForLog(error));
    return { status: "failed", message: SEND_FAILED_MESSAGE };
  }
}

export async function cancelSigningLinkAction(
  rentalId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (!isRecordId(rentalId)) {
    return failedState(NOT_FOUND_MESSAGE);
  }
  return runUserChange({
    description: "Cancelling a signing link",
    pagesToRefresh: [rentalPath(rentalId)],
    change: async (actor) =>
      (await cancelSigningLink(appDb, actor, rentalId, new Date())) === "cancelled"
        ? savedState("Link cancelled.")
        : failedState("There is no link to cancel."),
  });
}
