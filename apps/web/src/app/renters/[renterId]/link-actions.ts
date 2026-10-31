"use server";

import {
  describeErrorForLog,
  formatDateTimeInTimeZone,
  formatDayInTimeZone,
  isRecordId,
} from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";
import { revalidatePath } from "next/cache";

import { env } from "../../../env";
import { appDb } from "../../../lib/app-db";
import { appEmailSender } from "../../../lib/email-sender";
import { renterPath } from "../../../lib/paths";
import { cancelDetailsLink, sendDetailsLink } from "../../../lib/renter-links/details-links";
import { requireUser } from "../../../lib/require-user";
import { runUserChange } from "../../../lib/run-change";
import { loadOperatorSettings } from "../../../lib/settings/operator-settings";
import { RENTER_NOT_FOUND_MESSAGE } from "../renter-form-state";
import type { LinkSendState } from "./link-send-state";

const NO_EMAIL_MESSAGE =
  "Add the Renter's email first (Edit, above): the link and its codes are sent there.";
const SEND_FAILED_MESSAGE = "The link could not be sent. Try again in a moment.";

/** Sends (or sends again) the Renter's details form link; the old one stops working. */
export async function sendDetailsLinkAction(
  renterId: string,
  _previous: LinkSendState,
): Promise<LinkSendState> {
  const user = await requireUser();
  if (!isRecordId(renterId)) {
    return { status: "failed", message: RENTER_NOT_FOUND_MESSAGE };
  }
  try {
    const settings = await loadOperatorSettings(appDb, user.operatorId);
    const result = await sendDetailsLink(
      {
        database: appDb,
        emailSender: appEmailSender,
        now: () => new Date(),
        appUrl: env.APP_URL,
        describeDay: (moment) => formatDayInTimeZone(moment, user.operatorTimezone),
      },
      { userId: user.id, operatorId: user.operatorId },
      renterId,
      settings.renterLinkValidDays,
    );
    revalidatePath(renterPath(renterId));
    if (result.status === "no_email") {
      return { status: "failed", message: NO_EMAIL_MESSAGE };
    }
    if (result.status === "not_found") {
      return { status: "failed", message: RENTER_NOT_FOUND_MESSAGE };
    }
    return {
      status: "sent",
      url: result.url,
      expiresText: formatDateTimeInTimeZone(result.expiresAt, user.operatorTimezone),
    };
  } catch (error) {
    // Never the error's details: they could hold the link's address.
    console.error("Sending a details link failed", describeErrorForLog(error));
    return { status: "failed", message: SEND_FAILED_MESSAGE };
  }
}

export async function cancelDetailsLinkAction(
  renterId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (!isRecordId(renterId)) {
    return failedState(RENTER_NOT_FOUND_MESSAGE);
  }
  return runUserChange({
    description: "Cancelling a details link",
    pagesToRefresh: [renterPath(renterId)],
    change: async (actor) =>
      (await cancelDetailsLink(appDb, actor, renterId, new Date())) === "cancelled"
        ? savedState("Link cancelled.")
        : failedState("There is no link to cancel."),
  });
}
