"use server";

import { formatDayInTimeZone, formTextValues, isRecordId } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";
import { redirect } from "next/navigation";

import { appDb } from "../../../../lib/app-db";
import { appEmailSender } from "../../../../lib/email-sender";
import { fileDependencies } from "../../../../lib/files/file-action-support";
import { renterPath, renterReviewPath, RENTERS_PATH } from "../../../../lib/paths";
import { SEND_BACK_FIELDS, sendBackInputSchema } from "../../../../lib/renter-links/review-input";
import { approveSubmission, sendBackSubmission } from "../../../../lib/renter-links/reviews";
import { licenceOnFileState } from "../../../../lib/renters/licence-on-file";
import { runUserChange } from "../../../../lib/run-change";

const GONE_MESSAGE =
  "This was already reviewed, or the Renter is archived. Open the Renter's page to see where things are.";
const LINK_ENDED_MESSAGE =
  "The Renter's details link has ended, so they could not make the change. Send them a new link from their page first, then send this back.";

function pagesFor(renterId: string): string[] {
  return [renterPath(renterId), renterReviewPath(renterId), RENTERS_PATH];
}

/** Copies what the Renter sent onto their record, then goes back to the Renter's page. */
export async function approveSubmissionAction(
  renterId: string,
  submissionId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (!isRecordId(renterId) || !isRecordId(submissionId)) {
    return failedState(GONE_MESSAGE);
  }
  const state = await runUserChange({
    description: "Approving a Renter's submission",
    pagesToRefresh: pagesFor(renterId),
    change: async (actor) => {
      const result = await approveSubmission(fileDependencies(), actor, renterId, submissionId);
      if (typeof result === "object") {
        return licenceOnFileState(result);
      }
      return result === "approved" ? savedState("Approved.") : failedState(GONE_MESSAGE);
    },
  });
  // Outside runUserChange: Next carries out a redirect by throwing.
  if (state.status === "saved") {
    redirect(renterPath(renterId));
  }
  return state;
}

/** Sends what the Renter sent back with a note for them to fix, then goes back to the Renter's page. */
export async function sendBackSubmissionAction(
  renterId: string,
  submissionId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = sendBackInputSchema.safeParse(formTextValues(formData, SEND_BACK_FIELDS));
  if (!isRecordId(renterId) || !isRecordId(submissionId)) {
    return failedState(GONE_MESSAGE);
  }
  if (!parsed.success) {
    return failedState("Say what to change, so the Renter knows.");
  }
  const state = await runUserChange({
    description: "Sending a Renter's submission back",
    pagesToRefresh: pagesFor(renterId),
    change: async (actor, user) => {
      const result = await sendBackSubmission(
        {
          database: appDb,
          emailSender: appEmailSender,
          now: () => new Date(),
          describeDay: (moment) => formatDayInTimeZone(moment, user.operatorTimezone),
        },
        actor,
        renterId,
        { submissionId, note: parsed.data.note },
      );
      if (result.status === "link_ended") {
        return failedState(LINK_ENDED_MESSAGE);
      }
      return result.status === "sent_back" ? savedState("Sent back.") : failedState(GONE_MESSAGE);
    },
  });
  if (state.status === "saved") {
    redirect(renterPath(renterId));
  }
  return state;
}
