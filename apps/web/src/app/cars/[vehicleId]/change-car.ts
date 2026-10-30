import { isRecordId } from "@fleetapp/core";

import { failedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";
import type { ActingUser } from "../../../lib/acting-user";
import { carPath, CARS_PATH, INSURANCE_PATH } from "../../../lib/paths";
import { runUserChange } from "../../../lib/run-change";

export const NOT_FOUND_MESSAGE = "That car could not be found. It may have been archived.";

/** Checks the car's id from the page, then runs the change and refreshes the pages showing it. */
export function changeCar(
  vehicleId: string,
  description: string,
  change: (actor: ActingUser) => Promise<ChangeFormState>,
): Promise<ChangeFormState> {
  if (!isRecordId(vehicleId)) {
    return Promise.resolve(failedState(NOT_FOUND_MESSAGE));
  }
  return runUserChange({
    description,
    pagesToRefresh: [carPath(vehicleId), CARS_PATH, INSURANCE_PATH],
    change,
  });
}
