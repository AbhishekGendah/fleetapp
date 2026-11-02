"use server";

import { formTextValues } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";

import { appDb } from "../../lib/app-db";
import { SETTINGS_PATH } from "../../lib/paths";
import { runUserChange } from "../../lib/run-change";
import { saveOperatorSettings } from "../../lib/settings/operator-settings";
import { PHOTO_LIST_FIELDS, photoListInputSchema } from "../../lib/settings/photo-list-input";

/** Saves the handover photo list; new rentals use it, rentals already made keep theirs. */
export async function saveHandoverPhotosAction(
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = photoListInputSchema.safeParse(formTextValues(formData, PHOTO_LIST_FIELDS));
  if (!parsed.success) {
    return failedState("Put one photo on each line, each once, then try again.");
  }
  return runUserChange({
    description: "Saving the handover photo list",
    pagesToRefresh: [SETTINGS_PATH],
    change: async (actor) => {
      await saveOperatorSettings(appDb, actor, { handoverPhotos: parsed.data.photos });
      return savedState("Saved. New rentals use this list; rentals already made keep theirs.");
    },
  });
}
