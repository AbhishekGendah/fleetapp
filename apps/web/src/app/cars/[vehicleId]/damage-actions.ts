"use server";

import { formTextValues, isRecordId, todayInTimeZone } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";
import { redirect } from "next/navigation";

import type { ActingUser } from "../../../lib/acting-user";
import { appDb } from "../../../lib/app-db";
import {
  CLAIM_FORM_FIELDS,
  claimFormSchema,
  DAMAGE_STATUS_FIELDS,
  damageStatusFormSchema,
  FOUND_DAMAGE_FIELDS,
  foundDamageFormSchema,
} from "../../../lib/damage/damage-input";
import {
  archiveFoundDamage,
  changeDamageStatus,
  confirmDamageRental,
  findDamageCar,
  recordFoundDamage,
  saveClaim,
} from "../../../lib/damage/damage-records";
import { carDamagePath, carPath, HOME_PATH } from "../../../lib/paths";
import { TAB_PARAM } from "../../../lib/record-tabs";
import type { SignedInUser } from "../../../lib/require-user";
import { runUserChange } from "../../../lib/run-change";
import { changeCar } from "./change-car";

// The browser runs the same checks first, so these are only reached by a request that skipped them.
const INVALID_MESSAGE =
  "Some details are not right, so nothing was saved. Check them and try again.";
const DAMAGE_NOT_FOUND_MESSAGE = "That damage record could not be found. It may have been removed.";
const DAMAGE_TAB = "damage";

/** Checks the record is this car's, then runs the change and refreshes the pages showing it. */
async function changeDamage(
  ids: { vehicleId: string; damageId: string },
  description: string,
  change: (actor: ActingUser, user: SignedInUser) => Promise<ChangeFormState>,
): Promise<ChangeFormState> {
  if (!isRecordId(ids.vehicleId) || !isRecordId(ids.damageId)) {
    return failedState(DAMAGE_NOT_FOUND_MESSAGE);
  }
  return runUserChange({
    description,
    pagesToRefresh: [carPath(ids.vehicleId), carDamagePath(ids.vehicleId, ids.damageId), HOME_PATH],
    change: async (actor, user) => {
      const carId = await findDamageCar(appDb, actor.operatorId, ids.damageId);
      return carId === ids.vehicleId ? change(actor, user) : failedState(DAMAGE_NOT_FOUND_MESSAGE);
    },
  });
}

function changedOrNot(result: string, message: string): ChangeFormState {
  return result === "not_found" ? failedState(DAMAGE_NOT_FOUND_MESSAGE) : savedState(message);
}

export async function recordFoundDamageAction(
  vehicleId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const values = formTextValues(formData, FOUND_DAMAGE_FIELDS);
  return changeCar(vehicleId, "Recording damage on a car", async (actor, user) => {
    // "Not in the future" is read on the Operator's calendar, so it is checked once that is known.
    const today = todayInTimeZone(new Date(), user.operatorTimezone);
    const parsed = foundDamageFormSchema(today).safeParse(values);
    if (!parsed.success) {
      return failedState(INVALID_MESSAGE);
    }
    const result = await recordFoundDamage(appDb, actor, vehicleId, parsed.data);
    return result.status === "added"
      ? savedState("Damage recorded. Open it to add photos or a claim.")
      : failedState(DAMAGE_NOT_FOUND_MESSAGE);
  });
}

export async function changeDamageStatusAction(
  vehicleId: string,
  damageId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = damageStatusFormSchema.safeParse(formTextValues(formData, DAMAGE_STATUS_FIELDS));
  if (!parsed.success) {
    return failedState(INVALID_MESSAGE);
  }
  return changeDamage({ vehicleId, damageId }, "Changing a damage status", async (actor) =>
    changedOrNot(await changeDamageStatus(appDb, actor, damageId, parsed.data), "Status saved."),
  );
}

export async function saveClaimAction(
  vehicleId: string,
  damageId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = claimFormSchema.safeParse(formTextValues(formData, CLAIM_FORM_FIELDS));
  if (!parsed.success) {
    return failedState(INVALID_MESSAGE);
  }
  return changeDamage({ vehicleId, damageId }, "Saving an insurance claim", async (actor) =>
    changedOrNot(await saveClaim(appDb, actor, damageId, parsed.data), "Claim saved."),
  );
}

/** Confirms the suggested rental (`rentalId`), or clears who had the car (null). */
export async function confirmDamageRentalAction(
  vehicleId: string,
  damageId: string,
  rentalId: string | null,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (rentalId !== null && !isRecordId(rentalId)) {
    return failedState(DAMAGE_NOT_FOUND_MESSAGE);
  }
  return changeDamage({ vehicleId, damageId }, "Confirming who had a damaged car", async (actor) =>
    changedOrNot(
      await confirmDamageRental(appDb, actor, damageId, rentalId),
      rentalId ? "Saved as theirs." : "Cleared.",
    ),
  );
}

export async function archiveDamageAction(
  vehicleId: string,
  damageId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  const state = await changeDamage(
    { vehicleId, damageId },
    "Removing a damage record",
    async (actor) => changedOrNot(await archiveFoundDamage(appDb, actor, damageId), "Removed."),
  );
  if (state.status === "saved") {
    redirect(`${carPath(vehicleId)}?${TAB_PARAM}=${DAMAGE_TAB}`);
  }
  return state;
}
