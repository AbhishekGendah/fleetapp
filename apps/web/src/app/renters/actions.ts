"use server";

import { describeErrorForLog, formTextValues, isRecordId, todayInTimeZone } from "@fleetapp/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActingUser } from "../../lib/acting-user";
import { appDb } from "../../lib/app-db";
import { renterPath, RENTERS_PATH } from "../../lib/paths";
import { requireUser } from "../../lib/require-user";
import {
  parseRenterForm,
  RENTER_FORM_FIELDS,
  type RenterInput,
} from "../../lib/renters/renter-input";
import { createRenter, updateRenter } from "../../lib/renters/renter-records";
import { RENTER_NOT_FOUND_MESSAGE, type RenterFormState } from "./renter-form-state";

const UNEXPECTED_ERROR_MESSAGE = "Something went wrong and nothing was saved. Try again.";
// The browser runs the same checks first, so this is only reached by a
// request that skipped them.
const INVALID_MESSAGE =
  "Some details are not right, so nothing was saved. Check them and try again.";

/** Checks, saves, and on success goes to the Renter's page. Shared by adding and editing. */
async function saveRenterForm(
  formData: FormData,
  save: (actor: ActingUser, input: RenterInput) => Promise<string | null>,
): Promise<RenterFormState> {
  const user = await requireUser();
  const parsed = parseRenterForm(
    formTextValues(formData, RENTER_FORM_FIELDS),
    todayInTimeZone(new Date(), user.operatorTimezone),
  );
  if (!parsed.success) {
    return { status: "failed", formError: INVALID_MESSAGE };
  }

  let renterId: string | null;
  try {
    renterId = await save({ userId: user.id, operatorId: user.operatorId }, parsed.data);
  } catch (error) {
    console.error("Saving a Renter failed", describeErrorForLog(error));
    return { status: "failed", formError: UNEXPECTED_ERROR_MESSAGE };
  }
  if (!renterId) {
    return { status: "failed", formError: RENTER_NOT_FOUND_MESSAGE };
  }
  revalidatePath(RENTERS_PATH);
  // Outside the try: Next carries out a redirect by throwing.
  redirect(renterPath(renterId));
}

export async function addRenterAction(
  _previous: RenterFormState,
  formData: FormData,
): Promise<RenterFormState> {
  return saveRenterForm(formData, (actor, input) => createRenter(appDb, actor, input));
}

/** Bound to one Renter's id by the edit page; checked against the User's Operator on save. */
export async function editRenterAction(
  renterId: string,
  _previous: RenterFormState,
  formData: FormData,
): Promise<RenterFormState> {
  if (!isRecordId(renterId)) {
    return { status: "failed", formError: RENTER_NOT_FOUND_MESSAGE };
  }
  return saveRenterForm(formData, async (actor, input) => {
    const result = await updateRenter(appDb, actor, renterId, input);
    return result === "not_found" ? null : renterId;
  });
}
