"use server";

import { describeErrorForLog, formTextValues, isRecordId } from "@fleetapp/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActingUser } from "../../lib/acting-user";
import { appDb } from "../../lib/app-db";
import { carPath, CARS_PATH } from "../../lib/paths";
import { requireUser } from "../../lib/require-user";
import {
  parseVehicleForm,
  VEHICLE_FORM_FIELDS,
  type VehicleInput,
} from "../../lib/vehicles/vehicle-input";
import {
  createVehicle,
  updateVehicle,
  type SaveVehicleResult,
} from "../../lib/vehicles/vehicle-records";
import type { CarFormState } from "./car-form-state";

const UNEXPECTED_ERROR_MESSAGE = "Something went wrong and nothing was saved. Try again.";
// The browser runs the same checks first, so this is only reached by a
// request that skipped them.
const INVALID_MESSAGE =
  "Some details are not right, so nothing was saved. Check them and try again.";
const NOT_FOUND_MESSAGE = "That car could not be found. It may have been archived.";

type SaveCar = (
  actor: ActingUser,
  input: VehicleInput,
) => Promise<SaveVehicleResult | { status: "not_found" }>;

/** Checks, saves, and on success goes to the car's page. Shared by adding and editing. */
async function saveCarForm(formData: FormData, save: SaveCar): Promise<CarFormState> {
  const user = await requireUser();
  const parsed = parseVehicleForm(formTextValues(formData, VEHICLE_FORM_FIELDS), new Date());
  if (!parsed.success) {
    return { status: "failed", formError: INVALID_MESSAGE };
  }

  let result: Awaited<ReturnType<SaveCar>>;
  try {
    result = await save({ userId: user.id, operatorId: user.operatorId }, parsed.data);
  } catch (error) {
    console.error("Saving a car failed", describeErrorForLog(error));
    return { status: "failed", formError: UNEXPECTED_ERROR_MESSAGE };
  }

  if (result.status === "not_found") {
    return { status: "failed", formError: NOT_FOUND_MESSAGE };
  }
  if (result.status === "duplicate") {
    return {
      status: "duplicate",
      field: result.field,
      existingCarHref: result.existingVehicleId ? carPath(result.existingVehicleId) : null,
    };
  }
  revalidatePath(CARS_PATH);
  // Outside the try: Next carries out a redirect by throwing.
  redirect(carPath(result.vehicleId));
}

export async function addCarAction(
  _previous: CarFormState,
  formData: FormData,
): Promise<CarFormState> {
  return saveCarForm(formData, (actor, input) => createVehicle(appDb, actor, input));
}

/** Bound to one car's id by its edit page; the id is checked against the User's Operator on save. */
export async function editCarAction(
  vehicleId: string,
  _previous: CarFormState,
  formData: FormData,
): Promise<CarFormState> {
  if (!isRecordId(vehicleId)) {
    return { status: "failed", formError: NOT_FOUND_MESSAGE };
  }
  return saveCarForm(formData, (actor, input) => updateVehicle(appDb, actor, vehicleId, input));
}
