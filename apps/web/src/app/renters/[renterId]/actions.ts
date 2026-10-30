"use server";

import { formTextValues, isRecordId } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";

import type { ActingUser } from "../../../lib/acting-user";
import { appDb } from "../../../lib/app-db";
import { renterPath, RENTERS_PATH } from "../../../lib/paths";
import { RENTER_STATUS_FIELDS, renterStatusInputSchema } from "../../../lib/renters/renter-input";
import {
  archiveRenter,
  changeRenterStatus,
  restoreRenter,
} from "../../../lib/renters/renter-records";
import { runUserChange } from "../../../lib/run-change";
import { RENTER_NOT_FOUND_MESSAGE } from "../renter-form-state";

const INVALID_MESSAGE = "That is not right, so nothing was saved. Check it and try again.";

/** Checks the Renter's id from the page, then runs the change and refreshes their pages. */
function changeRenter(
  renterId: string,
  description: string,
  change: (actor: ActingUser) => Promise<ChangeFormState>,
): Promise<ChangeFormState> {
  if (!isRecordId(renterId)) {
    return Promise.resolve(failedState(RENTER_NOT_FOUND_MESSAGE));
  }
  return runUserChange({
    description,
    pagesToRefresh: [renterPath(renterId), RENTERS_PATH],
    change,
  });
}

export async function changeRenterStatusAction(
  renterId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = renterStatusInputSchema.safeParse(formTextValues(formData, RENTER_STATUS_FIELDS));
  if (!parsed.success) {
    return failedState(INVALID_MESSAGE);
  }
  return changeRenter(renterId, "Changing a Renter's status", async (actor) => {
    const result = await changeRenterStatus(appDb, actor, renterId, parsed.data);
    return result === "not_found"
      ? failedState(RENTER_NOT_FOUND_MESSAGE)
      : savedState("Status saved.");
  });
}

/** Archive and restore come from a single button, with nothing typed. */
export async function setRenterArchivedAction(
  renterId: string,
  shouldArchive: boolean,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  return changeRenter(
    renterId,
    shouldArchive ? "Archiving a Renter" : "Restoring a Renter",
    async (actor) => {
      const result = shouldArchive
        ? await archiveRenter(appDb, actor, renterId)
        : await restoreRenter(appDb, actor, renterId);
      return result === "not_found"
        ? failedState(RENTER_NOT_FOUND_MESSAGE)
        : savedState(shouldArchive ? "Archived." : "Restored.");
    },
  );
}
