"use server";

import { isRecordId } from "@fleetapp/core";
import { redirect } from "next/navigation";

import {
  failedState,
  savedState,
  type ChangeFormState,
} from "../../../components/change-form-state";
import type { ActingUser } from "../../../lib/acting-user";
import { appDb } from "../../../lib/app-db";
import { CARS_PATH, INSURANCE_PATH, policyPath } from "../../../lib/paths";
import { runUserChange } from "../../../lib/run-change";
import {
  addVehicleToPolicy,
  archivePolicy,
  createPolicy,
  removeVehicleFromPolicy,
  updatePolicy,
} from "../../../lib/vehicles/insurance";
import { chosenId, policyFromForm, tickedIds } from "../../../lib/vehicles/paperwork-form-data";
import { POLICY_CARS_FIELD } from "../policy-form";

const INVALID_MESSAGE =
  "Some details are not right, so nothing was saved. Check them and try again.";
const NOT_FOUND_MESSAGE = "That policy could not be found. It may have been archived.";
const CAR_NOT_FOUND_MESSAGE = "That car could not be found. It may have been archived.";

/** Checks the policy's id from the page, then runs the change and refreshes its pages. */
function changePolicy(
  policyId: string,
  description: string,
  change: (actor: ActingUser) => Promise<ChangeFormState>,
): Promise<ChangeFormState> {
  if (!isRecordId(policyId)) {
    return Promise.resolve(failedState(NOT_FOUND_MESSAGE));
  }
  return runUserChange({
    description,
    pagesToRefresh: [policyPath(policyId), INSURANCE_PATH, CARS_PATH],
    change,
  });
}

/** A new policy from the Insurance page, covering the cars ticked. */
export async function createPolicyAction(
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = policyFromForm(formData);
  if (!parsed.success) {
    return failedState(INVALID_MESSAGE);
  }
  let policyId: string | null = null;
  const state = await runUserChange({
    description: "Adding a policy",
    pagesToRefresh: [INSURANCE_PATH, CARS_PATH],
    change: async (actor) => {
      const result = await createPolicy(
        appDb,
        actor,
        parsed.data,
        tickedIds(formData, POLICY_CARS_FIELD),
      );
      if (result.status !== "created") {
        return failedState(CAR_NOT_FOUND_MESSAGE);
      }
      policyId = result.policyId;
      return savedState("Policy saved.");
    },
  });
  if (policyId) {
    // Outside the change: Next carries out a redirect by throwing.
    redirect(policyPath(policyId));
  }
  return state;
}

export async function updatePolicyAction(
  policyId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = policyFromForm(formData);
  if (!parsed.success) {
    return failedState(INVALID_MESSAGE);
  }
  return changePolicy(policyId, "Changing a policy", async (actor) => {
    const result = await updatePolicy(appDb, actor, policyId, parsed.data);
    return result === "not_found" ? failedState(NOT_FOUND_MESSAGE) : savedState("Saved.");
  });
}

export async function archivePolicyAction(
  policyId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  return changePolicy(policyId, "Archiving a policy", async (actor) =>
    (await archivePolicy(appDb, actor, policyId)) === "changed"
      ? savedState("Archived.")
      : failedState(NOT_FOUND_MESSAGE),
  );
}

export async function addCarToPolicyAction(
  policyId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const vehicleId = chosenId(formData);
  if (!vehicleId) {
    return failedState("Choose a car.");
  }
  return changePolicy(policyId, "Putting a car on a policy", async (actor) => {
    const result = await addVehicleToPolicy(appDb, actor, policyId, vehicleId);
    return result === "not_found" ? failedState(CAR_NOT_FOUND_MESSAGE) : savedState("Car added.");
  });
}

export async function removeCarFromPolicyAction(
  policyId: string,
  vehicleId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (!isRecordId(vehicleId)) {
    return failedState(CAR_NOT_FOUND_MESSAGE);
  }
  return changePolicy(policyId, "Taking a car off a policy", async (actor) =>
    (await removeVehicleFromPolicy(appDb, actor, policyId, vehicleId)) === "removed"
      ? savedState("Taken off.")
      : failedState("That car was already off the policy."),
  );
}
