"use server";

import { formTextValues, isRecordId } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";

import { billingDependencies } from "../../../lib/billing/billing-dependencies";
import {
  emailBillingDocumentAgain,
  issueStatement,
  type EmailAgainResult,
} from "../../../lib/billing/billing-statements";
import { STATEMENT_FIELDS, statementRangeSchema } from "../../../lib/billing/statement-input";
import { rentalPath } from "../../../lib/paths";
import { runUserChange } from "../../../lib/run-change";

const NOT_FOUND_MESSAGE = "That rental could not be found.";
const EMAIL_AGAIN_MESSAGES: Readonly<Record<EmailAgainResult, string>> = {
  sent: "Emailed to the Renter.",
  no_email: "The Renter has no email on file. Add one on their page, then try again.",
  not_found: "That document could not be found.",
  failed: "The email could not be sent. Try again in a minute.",
};

/** Bound to one rental and one of its documents: sends it to the Renter again. */
export async function emailDocumentAgainAction(
  rentalId: string,
  issuedDocumentId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (!isRecordId(rentalId) || !isRecordId(issuedDocumentId)) {
    return failedState(EMAIL_AGAIN_MESSAGES.not_found);
  }
  return runUserChange({
    description: "Emailing a document again",
    // A one-off charge's line says whether its invoice went, and its debit date.
    pagesToRefresh: [rentalPath(rentalId)],
    change: async (actor) => {
      const result = await emailBillingDocumentAgain(billingDependencies(), actor, {
        rentalId,
        issuedDocumentId,
      });
      return result === "sent"
        ? savedState(EMAIL_AGAIN_MESSAGES.sent)
        : failedState(EMAIL_AGAIN_MESSAGES[result]);
    },
  });
}

/** Bound to one rental: a statement for the days asked, kept with the rental's documents. */
export async function issueStatementAction(
  rentalId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = statementRangeSchema.safeParse(formTextValues(formData, STATEMENT_FIELDS));
  if (!isRecordId(rentalId)) {
    return failedState(NOT_FOUND_MESSAGE);
  }
  if (!parsed.success) {
    return failedState("Check the days marked in red, then try again.");
  }
  return runUserChange({
    description: "Issuing a statement",
    pagesToRefresh: [rentalPath(rentalId)],
    change: async (actor) => {
      const result = await issueStatement(billingDependencies(), actor, rentalId, parsed.data);
      return result.status === "issued"
        ? savedState("Statement made. Open it from the list.")
        : failedState(NOT_FOUND_MESSAGE);
    },
  });
}
