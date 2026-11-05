"use server";

import { documentEmailText, isRecordId } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";

import { emailDocumentAgain } from "../../../lib/contracts/document-emails";
import { appEmailSender } from "../../../lib/email-sender";
import { fileDependencies } from "../../../lib/files/file-action-support";
import { rentalPath } from "../../../lib/paths";
import { runUserChange } from "../../../lib/run-change";

const NOT_FOUND_MESSAGE = "That document could not be found.";

/** "Email again": the copies of a fixed document that didn't go are sent once more (review G9-9). */
export async function emailDocumentAgainAction(
  rentalId: string,
  documentId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (!isRecordId(rentalId) || !isRecordId(documentId)) {
    return failedState(NOT_FOUND_MESSAGE);
  }
  return runUserChange({
    description: "Emailing a document again",
    pagesToRefresh: [rentalPath(rentalId)],
    change: async (actor, user) => {
      const result = await emailDocumentAgain(
        { ...fileDependencies(), emailSender: appEmailSender },
        actor,
        documentId,
        user.operatorTimezone,
      );
      return result.status === "sent"
        ? savedState(documentEmailText(result.state))
        : failedState(NOT_FOUND_MESSAGE);
    },
  });
}
