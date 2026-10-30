"use server";

import { formatCalendarDate, formTextValues, isRecordId, todayInTimeZone } from "@fleetapp/core";

import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";
import { appDb } from "../../../lib/app-db";
import {
  addVehicleToPolicy,
  createPolicy,
  removeVehicleFromPolicy,
} from "../../../lib/vehicles/insurance";
import {
  addedCarState,
  coverOverlapWarning,
  SAME_POLICY_MESSAGE,
  samePolicyLink,
} from "../../../lib/vehicles/insurance-messages";
import { chosenId, policyFromForm, regoFromForm } from "../../../lib/vehicles/paperwork-form-data";
import {
  STOP_DIRECT_DEBIT_FIELDS,
  stopDirectDebitInputSchema,
} from "../../../lib/vehicles/paperwork-input";
import {
  addRegistration,
  archiveRegistration,
  stopDirectDebit,
  type RegistrationWarning,
} from "../../../lib/vehicles/registrations";
import { changeCar, NOT_FOUND_MESSAGE } from "./change-car";

// The browser runs the same checks first, so this is only reached by a request that skipped them.
const INVALID_MESSAGE =
  "Some details are not right, so nothing was saved. Check them and try again.";
function regoWarningMessage(warning: RegistrationWarning): string {
  return warning.kind === "earlier_than_current"
    ? "Saved, but it expires before the car's current rego, so the current rego has not changed."
    : `Saved. The direct debit takes over now; the current rego ran to ${formatCalendarDate(warning.currentExpiresOn)}.`;
}

export async function addRegoAction(
  vehicleId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = regoFromForm(formData);
  if (!parsed.success) {
    return failedState(INVALID_MESSAGE);
  }
  return changeCar(vehicleId, "Adding a rego renewal", async (actor, user) => {
    const today = todayInTimeZone(new Date(), user.operatorTimezone);
    const result = await addRegistration(appDb, actor, vehicleId, parsed.data, today);
    switch (result.status) {
      case "not_found":
        return failedState(NOT_FOUND_MESSAGE);
      case "duplicate":
        return failedState("That renewal is already recorded.");
      case "direct_debit_running":
        return failedState("This car already has a direct debit running. Stop it first.");
      case "added":
        return result.warning
          ? savedState(regoWarningMessage(result.warning), true)
          : savedState("Rego saved.");
    }
  });
}

export async function stopDirectDebitAction(
  vehicleId: string,
  registrationId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = stopDirectDebitInputSchema.safeParse(
    formTextValues(formData, STOP_DIRECT_DEBIT_FIELDS),
  );
  if (!isRecordId(registrationId) || !parsed.success) {
    return failedState(INVALID_MESSAGE);
  }
  return changeCar(vehicleId, "Stopping a rego direct debit", async (actor) =>
    (await stopDirectDebit(appDb, actor, registrationId, parsed.data.stoppedOn)) === "stopped"
      ? savedState("Direct debit stopped.")
      : failedState("That direct debit was already stopped."),
  );
}

export async function removeRegoAction(
  vehicleId: string,
  registrationId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (!isRecordId(registrationId)) {
    return failedState(NOT_FOUND_MESSAGE);
  }
  return changeCar(vehicleId, "Removing a rego renewal", async (actor) =>
    (await archiveRegistration(appDb, actor, registrationId)) === "archived"
      ? savedState("Removed.")
      : failedState("That renewal was already removed."),
  );
}

/** "Add insurance" on a car's page: a new policy covering just this car. */
export async function addPolicyForCarAction(
  vehicleId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = policyFromForm(formData);
  if (!parsed.success) {
    return failedState(INVALID_MESSAGE);
  }
  return changeCar(vehicleId, "Adding insurance for a car", async (actor) => {
    const result = await createPolicy(appDb, actor, parsed.data, [vehicleId]);
    if (result.status === "duplicate") {
      return failedState(SAME_POLICY_MESSAGE, samePolicyLink(result.policyId));
    }
    if (result.status === "not_found") {
      return failedState(NOT_FOUND_MESSAGE);
    }
    const warning = coverOverlapWarning(result.overlaps);
    return warning ? savedState(warning, true) : savedState("Insurance saved.");
  });
}

export async function joinPolicyAction(
  vehicleId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const policyId = chosenId(formData);
  if (!policyId) {
    return failedState("Choose a policy.");
  }
  return changeCar(vehicleId, "Putting a car on a policy", async (actor) => {
    const result = await addVehicleToPolicy(appDb, actor, policyId, vehicleId);
    return addedCarState(result, { notFound: NOT_FOUND_MESSAGE, added: "Added to the policy." });
  });
}

export async function leavePolicyAction(
  vehicleId: string,
  policyId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (!isRecordId(policyId)) {
    return failedState(NOT_FOUND_MESSAGE);
  }
  return changeCar(vehicleId, "Taking a car off a policy", async (actor) =>
    (await removeVehicleFromPolicy(appDb, actor, policyId, vehicleId)) === "removed"
      ? savedState("Taken off the policy.")
      : failedState("The car was already off that policy."),
  );
}
