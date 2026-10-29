"use server";

import { formTextValues, isRecordId } from "@fleetapp/core";

import { appDb } from "../../../lib/app-db";
import { changeCar, NOT_FOUND_MESSAGE } from "./change-car";
import { recordOdometerReading, withdrawOdometerReading } from "../../../lib/vehicles/odometer";
import { odometerInputSchema, vehicleStatusInputSchema } from "../../../lib/vehicles/vehicle-input";
import {
  archiveVehicle,
  changeVehicleStatus,
  restoreVehicle,
} from "../../../lib/vehicles/vehicle-records";
import {
  failedState,
  savedState,
  type ChangeFormState,
} from "../../../components/change-form-state";

const INVALID_MESSAGE = "That is not right, so nothing was saved. Check it and try again.";
const LOWER_READING_WARNING =
  "Saved, but it is lower than the last reading. Check it; if it was a slip, withdraw it and enter it again.";

export async function changeStatusAction(
  vehicleId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = vehicleStatusInputSchema.safeParse(
    formTextValues(formData, ["status", "statusReason", "statusExpectedBack"]),
  );
  if (!parsed.success) {
    return failedState(INVALID_MESSAGE);
  }
  return changeCar(vehicleId, "Changing a car's status", async (actor) => {
    const result = await changeVehicleStatus(appDb, actor, vehicleId, parsed.data);
    return result === "not_found" ? failedState(NOT_FOUND_MESSAGE) : savedState("Status saved.");
  });
}

export async function recordReadingAction(
  vehicleId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = odometerInputSchema.safeParse(formTextValues(formData, ["kilometres"]));
  if (!parsed.success) {
    return failedState(INVALID_MESSAGE);
  }
  return changeCar(vehicleId, "Recording an odometer reading", async (actor) => {
    const result = await recordOdometerReading(appDb, actor, vehicleId, parsed.data.kilometres);
    if (result.status === "not_found") {
      return failedState(NOT_FOUND_MESSAGE);
    }
    return result.isLowerThanLast
      ? savedState(LOWER_READING_WARNING, true)
      : savedState("Reading saved.");
  });
}

/** Archive and restore come from a single button, with nothing typed. */
export async function setArchivedAction(
  vehicleId: string,
  shouldArchive: boolean,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  return changeCar(
    vehicleId,
    shouldArchive ? "Archiving a car" : "Restoring a car",
    async (actor) => {
      const result = shouldArchive
        ? await archiveVehicle(appDb, actor, vehicleId)
        : await restoreVehicle(appDb, actor, vehicleId);
      if (typeof result === "object") {
        return failedState(
          `Another car now has this ${result.field === "rego" ? "rego" : "VIN"}. Archive or change that car first.`,
        );
      }
      return result === "not_found"
        ? failedState(NOT_FOUND_MESSAGE)
        : savedState(shouldArchive ? "Archived." : "Restored.");
    },
  );
}

export async function withdrawReadingAction(
  vehicleId: string,
  readingId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (!isRecordId(readingId)) {
    return failedState(NOT_FOUND_MESSAGE);
  }
  return changeCar(vehicleId, "Withdrawing an odometer reading", async (actor) => {
    const result = await withdrawOdometerReading(appDb, actor, readingId);
    return result === "not_found"
      ? failedState("That reading was already withdrawn.")
      : savedState("Reading withdrawn.");
  });
}
