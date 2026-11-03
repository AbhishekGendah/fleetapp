"use server";

import { formTextValues, isRecordId } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";

import { appDb } from "../../../lib/app-db";
import {
  addChargeType,
  archiveChargeType,
  updateChargeType,
} from "../../../lib/ledger/charge-types";
import {
  CHARGE_TYPE_FIELDS,
  chargeTypeInputSchema,
  GST_TREATMENT_FIELDS,
  gstTreatmentInputSchema,
} from "../../../lib/ledger/ledger-input";
import { CHARGE_TYPES_PATH } from "../../../lib/paths";
import { runUserChange } from "../../../lib/run-change";

const CHECK_MESSAGE = "Check the boxes marked in red, then try again.";
const NOT_FOUND_MESSAGE = "That charge type could not be found.";

/** Adds one of the business's own charge types. */
export async function addChargeTypeAction(
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = chargeTypeInputSchema.safeParse(formTextValues(formData, CHARGE_TYPE_FIELDS));
  if (!parsed.success) {
    return failedState(CHECK_MESSAGE);
  }
  return runUserChange({
    description: "Adding a charge type",
    pagesToRefresh: [CHARGE_TYPES_PATH],
    change: async (actor) => {
      await addChargeType(appDb, actor, parsed.data);
      return savedState("Charge type added.");
    },
  });
}

/** Bound to one type: its name (an own type) and GST, or only GST (a built-in type). */
export async function updateChargeTypeAction(
  chargeTypeId: string,
  isBuiltIn: boolean,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = isBuiltIn
    ? gstTreatmentInputSchema.safeParse(formTextValues(formData, GST_TREATMENT_FIELDS))
    : chargeTypeInputSchema.safeParse(formTextValues(formData, CHARGE_TYPE_FIELDS));
  if (!isRecordId(chargeTypeId) || !parsed.success) {
    return failedState(CHECK_MESSAGE);
  }
  return runUserChange({
    description: "Changing a charge type",
    pagesToRefresh: [CHARGE_TYPES_PATH],
    change: async (actor) =>
      (await updateChargeType(appDb, actor, chargeTypeId, parsed.data)) === "saved"
        ? savedState("Saved. Charges added from now on use it.")
        : failedState(NOT_FOUND_MESSAGE),
  });
}

/** Bound to one of the business's own types: no new charges of it; past ones keep it. */
export async function archiveChargeTypeAction(chargeTypeId: string): Promise<ChangeFormState> {
  if (!isRecordId(chargeTypeId)) {
    return failedState(NOT_FOUND_MESSAGE);
  }
  return runUserChange({
    description: "Archiving a charge type",
    pagesToRefresh: [CHARGE_TYPES_PATH],
    change: async (actor) => {
      const result = await archiveChargeType(appDb, actor, chargeTypeId);
      if (result === "built_in") {
        return failedState("A built-in type stays: change its GST instead.");
      }
      return result === "archived"
        ? savedState("Archived. Charges already added keep it.")
        : failedState(NOT_FOUND_MESSAGE);
    },
  });
}
