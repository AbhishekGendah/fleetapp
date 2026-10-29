"use server";

import { describeErrorForLog, formTextValues, isRecordId } from "@fleetapp/core";
import { revalidatePath } from "next/cache";

import type { ActingUser } from "../../../lib/acting-user";
import { appDb } from "../../../lib/app-db";
import { carPath, CARS_PATH } from "../../../lib/paths";
import { requireUser } from "../../../lib/require-user";
import { recordOdometerReading, withdrawOdometerReading } from "../../../lib/vehicles/odometer";
import { odometerInputSchema, vehicleStatusInputSchema } from "../../../lib/vehicles/vehicle-input";
import {
  archiveVehicle,
  changeVehicleStatus,
  restoreVehicle,
} from "../../../lib/vehicles/vehicle-records";
import type { CarPageFormState } from "./car-page-state";

const UNEXPECTED_ERROR_MESSAGE = "Something went wrong and nothing was saved. Try again.";
const INVALID_MESSAGE = "That is not right, so nothing was saved. Check it and try again.";
const NOT_FOUND_MESSAGE = "That car could not be found. It may have been archived.";
const LOWER_READING_WARNING =
  "Saved, but it is lower than the last reading. Check it; if it was a slip, withdraw it and enter it again.";

/** Signs in, checks the id, runs the change, and refreshes the car's pages. */
async function changeCar(
  vehicleId: string,
  description: string,
  change: (actor: ActingUser) => Promise<CarPageFormState>,
): Promise<CarPageFormState> {
  const user = await requireUser();
  if (!isRecordId(vehicleId)) {
    return { status: "failed", formError: NOT_FOUND_MESSAGE };
  }
  try {
    const state = await change({ userId: user.id, operatorId: user.operatorId });
    revalidatePath(carPath(vehicleId));
    revalidatePath(CARS_PATH);
    return state;
  } catch (error) {
    console.error(`${description} failed`, describeErrorForLog(error));
    return { status: "failed", formError: UNEXPECTED_ERROR_MESSAGE };
  }
}

export async function changeStatusAction(
  vehicleId: string,
  _previous: CarPageFormState,
  formData: FormData,
): Promise<CarPageFormState> {
  const parsed = vehicleStatusInputSchema.safeParse(
    formTextValues(formData, ["status", "statusReason", "statusExpectedBack"]),
  );
  if (!parsed.success) {
    return { status: "failed", formError: INVALID_MESSAGE };
  }
  return changeCar(vehicleId, "Changing a car's status", async (actor) => {
    const result = await changeVehicleStatus(appDb, actor, vehicleId, parsed.data);
    return result === "not_found"
      ? { status: "failed", formError: NOT_FOUND_MESSAGE }
      : { status: "saved", message: "Status saved.", isWarning: false };
  });
}

export async function recordReadingAction(
  vehicleId: string,
  _previous: CarPageFormState,
  formData: FormData,
): Promise<CarPageFormState> {
  const parsed = odometerInputSchema.safeParse(formTextValues(formData, ["kilometres"]));
  if (!parsed.success) {
    return { status: "failed", formError: INVALID_MESSAGE };
  }
  return changeCar(vehicleId, "Recording an odometer reading", async (actor) => {
    const result = await recordOdometerReading(appDb, actor, vehicleId, parsed.data.kilometres);
    if (result.status === "not_found") {
      return { status: "failed", formError: NOT_FOUND_MESSAGE };
    }
    return result.isLowerThanLast
      ? { status: "saved", message: LOWER_READING_WARNING, isWarning: true }
      : { status: "saved", message: "Reading saved.", isWarning: false };
  });
}

/** Archive and restore come from a single button, with nothing typed. */
export async function setArchivedAction(
  vehicleId: string,
  shouldArchive: boolean,
  _previous: CarPageFormState,
): Promise<CarPageFormState> {
  return changeCar(
    vehicleId,
    shouldArchive ? "Archiving a car" : "Restoring a car",
    async (actor) => {
      const result = shouldArchive
        ? await archiveVehicle(appDb, actor, vehicleId)
        : await restoreVehicle(appDb, actor, vehicleId);
      if (typeof result === "object") {
        return {
          status: "failed",
          formError: `Another car now has this ${result.field === "rego" ? "rego" : "VIN"}. Archive or change that car first.`,
        };
      }
      return result === "not_found"
        ? { status: "failed", formError: NOT_FOUND_MESSAGE }
        : { status: "saved", message: shouldArchive ? "Archived." : "Restored.", isWarning: false };
    },
  );
}

export async function withdrawReadingAction(
  vehicleId: string,
  readingId: string,
  _previous: CarPageFormState,
): Promise<CarPageFormState> {
  if (!isRecordId(readingId)) {
    return { status: "failed", formError: NOT_FOUND_MESSAGE };
  }
  return changeCar(vehicleId, "Withdrawing an odometer reading", async (actor) => {
    const result = await withdrawOdometerReading(appDb, actor, readingId);
    return result === "not_found"
      ? { status: "failed", formError: "That reading was already withdrawn." }
      : { status: "saved", message: "Reading withdrawn.", isWarning: false };
  });
}
