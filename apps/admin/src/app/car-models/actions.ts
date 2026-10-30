"use server";

import { describeErrorForLog, formTextValues, isRecordId } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { z } from "zod";

import { appDb } from "../../lib/app-db";
import {
  ADD_AND_FIX_INTENT,
  ADD_MODELS_FIELDS,
  addModelsInputSchema,
  CAR_NAME_FIELDS,
  carNameInputSchema,
  CATALOGUE_ENTRY_FIELDS,
  catalogueEntryInputSchema,
  FIX_INTENT_FIELD,
} from "../../lib/car-models/car-model-input";
import {
  addMakeAndModel,
  addModels,
  createMake,
  fixCarMakeAndModel,
  setCatalogueEntryHidden,
  updateCatalogueEntry,
  type CatalogueEntryKind,
} from "../../lib/car-models/car-model-records";
import { CAR_MODELS_PATH, carMakePath, TYPED_BY_OPERATORS_PATH } from "../../lib/paths";
import { requireAdmin } from "../../lib/require-admin";

const UNEXPECTED_ERROR_MESSAGE = "Something went wrong and nothing was saved. Try again.";
const INVALID_MESSAGE = "That is not right, so nothing was saved. Check it and try again.";
const NOT_FOUND_MESSAGE = "That could not be found. Refresh the page.";
const DUPLICATE_MESSAGE = "That name is already in the list.";

/** Signs the Admin in, runs the change, refreshes the list pages, and hides any failure's details. */
async function runCatalogueChange(
  description: string,
  change: (adminUserId: string) => Promise<ChangeFormState>,
): Promise<ChangeFormState> {
  const admin = await requireAdmin();
  try {
    const state = await change(admin.id);
    revalidatePath(CAR_MODELS_PATH, "layout");
    return state;
  } catch (error) {
    console.error(`${description} failed`, describeErrorForLog(error));
    return failedState(UNEXPECTED_ERROR_MESSAGE);
  }
}

function parsed<Schema extends z.ZodType>(
  schema: Schema,
  formData: FormData,
  fields: readonly string[],
): z.infer<Schema> | null {
  const result = schema.safeParse(formTextValues(formData, fields));
  return result.success ? result.data : null;
}

export async function createMakeAction(
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const input = parsed(catalogueEntryInputSchema, formData, CATALOGUE_ENTRY_FIELDS);
  if (!input) {
    return failedState(INVALID_MESSAGE);
  }
  let makeId: string | null = null;
  const state = await runCatalogueChange("Adding a make", async (adminUserId) => {
    const result = await createMake(appDb, adminUserId, input);
    if (result === "duplicate") {
      return failedState(DUPLICATE_MESSAGE);
    }
    makeId = result.makeId;
    return savedState("Make added.");
  });
  if (makeId) {
    // Outside the change: Next carries out a redirect by throwing.
    redirect(carMakePath(makeId));
  }
  return state;
}

/** Renaming a make or model, or changing its nicknames. Bound to the entry by its page. */
export async function updateEntryAction(
  kind: CatalogueEntryKind,
  entryId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const input = parsed(catalogueEntryInputSchema, formData, CATALOGUE_ENTRY_FIELDS);
  if (!input || !isRecordId(entryId)) {
    return failedState(INVALID_MESSAGE);
  }
  return runCatalogueChange(`Changing a ${kind}`, async (adminUserId) => {
    const result = await updateCatalogueEntry(appDb, adminUserId, kind, entryId, input);
    return result === "duplicate"
      ? failedState(DUPLICATE_MESSAGE)
      : result === "not_found"
        ? failedState(NOT_FOUND_MESSAGE)
        : savedState("Saved. Every Operator's car form now uses it.");
  });
}

export async function setEntryHiddenAction(
  kind: CatalogueEntryKind,
  entryId: string,
  isHidden: boolean,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (!isRecordId(entryId)) {
    return failedState(NOT_FOUND_MESSAGE);
  }
  return runCatalogueChange(
    isHidden ? `Hiding a ${kind}` : `Showing a ${kind}`,
    async (adminUserId) =>
      (await setCatalogueEntryHidden(appDb, adminUserId, kind, entryId, isHidden)) === "changed"
        ? savedState(isHidden ? "Hidden from suggestions." : "Shown in suggestions again.")
        : failedState(NOT_FOUND_MESSAGE),
  );
}

function describeAdded(result: { added: string[]; alreadyListed: string[] }): string {
  const added =
    result.added.length > 0 ? `Added: ${result.added.join(", ")}.` : "Nothing new to add.";
  return result.alreadyListed.length > 0
    ? `${added} Already listed: ${result.alreadyListed.join(", ")}.`
    : added;
}

export async function addModelsAction(
  makeId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const input = parsed(addModelsInputSchema, formData, ADD_MODELS_FIELDS);
  if (!input || !isRecordId(makeId)) {
    return failedState(INVALID_MESSAGE);
  }
  return runCatalogueChange("Adding models", async (adminUserId) => {
    const result = await addModels(appDb, adminUserId, makeId, input.names);
    return result === "not_found"
      ? failedState(NOT_FOUND_MESSAGE)
      : savedState(describeAdded(result));
  });
}

/**
 * The Typed by Operators form: fix this one car to the make and model
 * chosen, after adding them to the list first if that button was pressed.
 */
export async function fixCarAction(
  vehicleId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const car = parsed(carNameInputSchema, formData, CAR_NAME_FIELDS);
  if (!car || !isRecordId(vehicleId)) {
    return failedState(INVALID_MESSAGE);
  }
  const shouldAdd = formData.get(FIX_INTENT_FIELD) === ADD_AND_FIX_INTENT;
  const state = await runCatalogueChange("Fixing an Operator's car", async (adminUserId) => {
    if (shouldAdd) {
      await addMakeAndModel(appDb, adminUserId, car);
    }
    return (await fixCarMakeAndModel(appDb, adminUserId, vehicleId, car)) === "fixed"
      ? savedState(shouldAdd ? "Added to the list and fixed." : "Fixed.")
      : failedState("That car is no longer there: it may have been archived.");
  });
  revalidatePath(TYPED_BY_OPERATORS_PATH);
  return state;
}
