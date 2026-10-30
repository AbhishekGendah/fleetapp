"use server";

import { formTextValues, isRecordId } from "@fleetapp/core";

import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";
import { appDb } from "../../../lib/app-db";
import {
  COST_FORM_FIELDS,
  parseCostForm,
  parsePurchaseForm,
  parseSaleForm,
  PURCHASE_FORM_FIELDS,
  SALE_FORM_FIELDS,
} from "../../../lib/vehicles/cost-input";
import {
  addCost,
  archiveCost,
  cancelSale,
  savePurchase,
  saveSale,
  type SaveRecordResult,
} from "../../../lib/vehicles/cost-records";
import { changeCar, NOT_FOUND_MESSAGE } from "./change-car";

// The browser runs the same checks first, so this is only reached by a request that skipped them.
const INVALID_MESSAGE =
  "Some details are not right, so nothing was saved. Check them and try again.";

function savedOrNot(result: SaveRecordResult, savedMessage: string): ChangeFormState {
  if (result === "not_found") {
    return failedState(NOT_FOUND_MESSAGE);
  }
  return savedState(result === "unchanged" ? "Nothing had changed." : savedMessage);
}

export async function savePurchaseAction(
  vehicleId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = parsePurchaseForm(formTextValues(formData, PURCHASE_FORM_FIELDS));
  if (!parsed.success) {
    return failedState(INVALID_MESSAGE);
  }
  return changeCar(vehicleId, "Saving a car's purchase", async (actor, user) =>
    savedOrNot(
      await savePurchase(appDb, actor, vehicleId, parsed.data, user.operatorTimezone),
      "Purchase saved.",
    ),
  );
}

export async function saveSaleAction(
  vehicleId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const values = formTextValues(formData, SALE_FORM_FIELDS);
  return changeCar(vehicleId, "Saving a car's sale", async (actor, user) => {
    // The handover time is read on the Operator's clock, so it is checked once that is known.
    const parsed = parseSaleForm(values, user.operatorTimezone);
    if (!parsed.success) {
      return failedState(INVALID_MESSAGE);
    }
    return savedOrNot(await saveSale(appDb, actor, vehicleId, parsed.data), "Sale saved.");
  });
}

export async function cancelSaleAction(
  vehicleId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  return changeCar(vehicleId, "Cancelling a car's sale", async (actor) =>
    (await cancelSale(appDb, actor, vehicleId)) === "cancelled"
      ? savedState("Sale cancelled. The car is available again.")
      : failedState("That sale was already cancelled."),
  );
}

export async function addCostAction(
  vehicleId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = parseCostForm(formTextValues(formData, COST_FORM_FIELDS));
  if (!parsed.success) {
    return failedState(INVALID_MESSAGE);
  }
  return changeCar(vehicleId, "Adding a car cost", async (actor) =>
    (await addCost(appDb, actor, vehicleId, parsed.data)) === "added"
      ? savedState("Cost saved.")
      : failedState(NOT_FOUND_MESSAGE),
  );
}

export async function removeCostAction(
  vehicleId: string,
  costId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (!isRecordId(costId)) {
    return failedState(NOT_FOUND_MESSAGE);
  }
  return changeCar(vehicleId, "Removing a car cost", async (actor) =>
    (await archiveCost(appDb, actor, costId)) === "archived"
      ? savedState("Removed.")
      : failedState("That cost was already removed."),
  );
}
