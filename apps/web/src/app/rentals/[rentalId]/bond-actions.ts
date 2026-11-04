"use server";

import { formatCents, formTextValues, isRecordId, todayInTimeZone } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";

import { appDb } from "../../../lib/app-db";
import {
  BOND_RECEIVED_FIELDS,
  BOND_REVERSAL_FIELDS,
  bondReceivedInputSchema,
  bondReversalInputSchema,
} from "../../../lib/bonds/bond-input";
import { recordBondReceived, reverseBondMovement } from "../../../lib/bonds/bond-records";
import { rentalPath } from "../../../lib/paths";
import { runUserChange } from "../../../lib/run-change";

const NOT_FOUND_MESSAGE = "That rental could not be found.";
const CHECK_MESSAGE = "Check the boxes marked in red, then try again.";

function heldText(heldCents: number): string {
  return `Bond held now: ${formatCents(heldCents)}.`;
}

/** Bound to one rental by its page: bond received by bank transfer or cash. */
export async function recordBondReceivedAction(
  rentalId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  if (!isRecordId(rentalId)) {
    return failedState(NOT_FOUND_MESSAGE);
  }
  return runUserChange({
    description: "Recording bond received",
    pagesToRefresh: [rentalPath(rentalId)],
    change: async (actor, user) => {
      const today = todayInTimeZone(new Date(), user.operatorTimezone);
      const parsed = bondReceivedInputSchema(today).safeParse(
        formTextValues(formData, BOND_RECEIVED_FIELDS),
      );
      if (!parsed.success) {
        return failedState(CHECK_MESSAGE);
      }
      const result = await recordBondReceived(appDb, actor, rentalId, parsed.data);
      if (result.status === "more_than_owing") {
        return failedState(
          result.owingCents === 0
            ? "The bond is already held in full."
            : `That is more than the ${formatCents(result.owingCents)} still to receive.`,
        );
      }
      if (result.status === "on_its_way") {
        return failedState(
          `A bank debit of ${formatCents(result.onItsWayCents)} for the bond is on its way. ${
            result.toReceiveByHandCents > 0
              ? `Record no more than ${formatCents(result.toReceiveByHandCents)} now. `
              : ""
          }If it bounces, you can record the bond then.`,
        );
      }
      if (result.status === "not_open") {
        return failedState("This rental is closed or cancelled, so no bond can be added.");
      }
      return result.status === "saved"
        ? savedState(`Recorded. ${heldText(result.account.heldCents)}`)
        : failedState(NOT_FOUND_MESSAGE);
    },
  });
}

const REVERSAL_REFUSED_MESSAGES = {
  not_found: "That entry could not be found.",
  not_reversible: "That entry has already been corrected.",
  would_go_below_nothing:
    "Correcting it would leave less than nothing held: correct the later entries first.",
} as const;

/** Bound to one entry by its page: undoes it exactly, with the reason. */
export async function reverseBondMovementAction(
  rentalId: string,
  movementId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = bondReversalInputSchema.safeParse(formTextValues(formData, BOND_REVERSAL_FIELDS));
  if (!isRecordId(rentalId) || !isRecordId(movementId) || !parsed.success) {
    return failedState("Say why it is being corrected, then try again.");
  }
  return runUserChange({
    description: "Correcting a bond entry",
    pagesToRefresh: [rentalPath(rentalId)],
    change: async (actor, user) => {
      const today = todayInTimeZone(new Date(), user.operatorTimezone);
      const result = await reverseBondMovement(
        appDb,
        actor,
        { rentalId, movementId },
        parsed.data,
        today,
      );
      return result.status === "saved"
        ? savedState(`Corrected. ${heldText(result.account.heldCents)}`)
        : failedState(REVERSAL_REFUSED_MESSAGES[result.status]);
    },
  });
}
