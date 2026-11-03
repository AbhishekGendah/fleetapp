"use server";

import { formTextValues, isRecordId, todayInTimeZone } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";

import { appDb } from "../../../lib/app-db";
import {
  CHARGE_FIELDS,
  chargeInputSchema,
  REVERSAL_FIELDS,
  reversalInputSchema,
} from "../../../lib/ledger/ledger-input";
import {
  addCharge,
  recordPayment,
  reverseLine,
  type LedgerChangeResult,
} from "../../../lib/ledger/ledger-records";
import {
  MANUAL_PAYMENT_FIELDS,
  manualPaymentInputSchema,
} from "../../../lib/money/manual-payment-input";
import { carDamagePath, rentalPath } from "../../../lib/paths";
import { runUserChange } from "../../../lib/run-change";
import { balanceText } from "../ledger-line-list";

const NOT_FOUND_MESSAGE = "That rental could not be found.";
const CHECK_MESSAGE = "Check the boxes marked in red, then try again.";
const REFUSED_MESSAGES: Readonly<Record<Exclude<LedgerChangeResult["status"], "saved">, string>> = {
  not_found: NOT_FOUND_MESSAGE,
  not_open: "This rental is a draft, cancelled or closed, so nothing can be added to it.",
  no_charge_type: "That charge type is no longer in use. Choose another.",
  not_reversible: "That line has already been reversed, or is itself a reversal.",
};

function answerFor(result: LedgerChangeResult, saved: string): ChangeFormState {
  return result.status === "saved"
    ? savedState(`${saved} ${balanceText(result.ledger.balanceCents)}.`)
    : failedState(REFUSED_MESSAGES[result.status]);
}

/** Bound to one rental (and a damage record of a car, from its page): a one-off charge. */
export async function addChargeAction(
  rentalId: string,
  damage: { recordId: string; vehicleId: string } | null,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = chargeInputSchema.safeParse(formTextValues(formData, CHARGE_FIELDS));
  const isDamageValid =
    damage === null || (isRecordId(damage.recordId) && isRecordId(damage.vehicleId));
  if (!isRecordId(rentalId) || !isDamageValid) {
    return failedState(NOT_FOUND_MESSAGE);
  }
  if (!parsed.success) {
    return failedState(CHECK_MESSAGE);
  }
  return runUserChange({
    description: "Adding a charge",
    pagesToRefresh: [
      rentalPath(rentalId),
      ...(damage ? [carDamagePath(damage.vehicleId, damage.recordId)] : []),
    ],
    change: async (actor) =>
      answerFor(
        await addCharge(appDb, actor, rentalId, {
          ...parsed.data,
          ...(damage ? { damageRecordId: damage.recordId } : {}),
        }),
        "Charge added.",
      ),
  });
}

/** Bound to one rental: a payment received by bank transfer or cash. */
export async function recordPaymentAction(
  rentalId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  if (!isRecordId(rentalId)) {
    return failedState(NOT_FOUND_MESSAGE);
  }
  return runUserChange({
    description: "Recording a payment",
    pagesToRefresh: [rentalPath(rentalId)],
    change: async (actor, user) => {
      const today = todayInTimeZone(new Date(), user.operatorTimezone);
      const parsed = manualPaymentInputSchema(today).safeParse(
        formTextValues(formData, MANUAL_PAYMENT_FIELDS),
      );
      if (!parsed.success) {
        return failedState(CHECK_MESSAGE);
      }
      return answerFor(
        await recordPayment(appDb, actor, rentalId, parsed.data),
        "Payment recorded.",
      );
    },
  });
}

/** Bound to one line: undoes it exactly, with the reason the Renter will read. */
export async function reverseLineAction(
  rentalId: string,
  lineId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = reversalInputSchema.safeParse(formTextValues(formData, REVERSAL_FIELDS));
  if (!isRecordId(rentalId) || !isRecordId(lineId) || !parsed.success) {
    return failedState("Say why it is being reversed, then try again.");
  }
  return runUserChange({
    description: "Reversing a ledger line",
    pagesToRefresh: [rentalPath(rentalId)],
    change: async (actor, user) =>
      answerFor(
        await reverseLine(
          appDb,
          actor,
          { rentalId, lineId },
          parsed.data,
          todayInTimeZone(new Date(), user.operatorTimezone),
        ),
        "Reversed.",
      ),
  });
}
