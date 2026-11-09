"use server";

import { formTextValues, isRecordId, type DocumentEmailOutcome } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";

import { billingDependencies } from "../../../lib/billing/billing-dependencies";
import {
  emailRenterStatementAgain,
  issueBusinessStatement,
} from "../../../lib/billing/business-statements";
import {
  BUSINESS_STATEMENT_FIELDS,
  businessStatementSchema,
} from "../../../lib/billing/statement-input";
import { renterPath } from "../../../lib/paths";
import { runUserChange } from "../../../lib/run-change";
import { RENTER_NOT_FOUND_MESSAGE } from "../renter-form-state";

const NOT_FOUND_MESSAGE = "That statement could not be found.";
const NOT_CURRENT_MESSAGE =
  "This business is archived, so no new statement is made. Restore it first; its statements are kept.";
const CHECK_DAYS_MESSAGE = "Check the days marked in red, then try again.";

/** What came of emailing a statement to the business's contact, in the Operator's words. */
const EMAILED_MESSAGES: Readonly<Record<DocumentEmailOutcome, string>> = {
  sent: "Emailed to the business's contact.",
  no_address: "Not emailed: the business has no email on file. Add one on its Details tab.",
  failed: "The email could not be sent. Try Email again in a minute.",
};

/** Bound to one business: its statement across its cars for the days asked, emailed when ticked. */
export async function issueBusinessStatementAction(
  renterId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  if (!isRecordId(renterId)) {
    return failedState(RENTER_NOT_FOUND_MESSAGE);
  }
  const parsed = businessStatementSchema.safeParse(
    formTextValues(formData, BUSINESS_STATEMENT_FIELDS),
  );
  if (!parsed.success) {
    return failedState(CHECK_DAYS_MESSAGE);
  }
  return runUserChange({
    description: "Issuing a business statement",
    pagesToRefresh: [renterPath(renterId)],
    change: async (actor) => {
      const result = await issueBusinessStatement(
        billingDependencies(),
        actor,
        renterId,
        parsed.data,
      );
      if (result.status === "not_current") {
        return failedState(NOT_CURRENT_MESSAGE);
      }
      if (result.status !== "issued") {
        return failedState(RENTER_NOT_FOUND_MESSAGE);
      }
      const made = "Statement made. Open it from the list.";
      if (result.emailOutcome === null) {
        return savedState(made);
      }
      return result.emailOutcome === "sent"
        ? savedState(`${made} ${EMAILED_MESSAGES.sent}`)
        : savedState(`${made} ${EMAILED_MESSAGES[result.emailOutcome]}`, true);
    },
  });
}

/** Bound to one business and one of its statements: sends it to the contact again. */
export async function emailStatementAgainAction(
  renterId: string,
  issuedDocumentId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (!isRecordId(renterId) || !isRecordId(issuedDocumentId)) {
    return failedState(NOT_FOUND_MESSAGE);
  }
  return runUserChange({
    description: "Emailing a statement again",
    pagesToRefresh: [renterPath(renterId)],
    change: async (actor) => {
      const outcome = await emailRenterStatementAgain(billingDependencies(), actor, {
        renterId,
        issuedDocumentId,
      });
      if (outcome === "not_found") {
        return failedState(NOT_FOUND_MESSAGE);
      }
      return outcome === "sent"
        ? savedState(EMAILED_MESSAGES.sent)
        : failedState(EMAILED_MESSAGES[outcome]);
    },
  });
}
