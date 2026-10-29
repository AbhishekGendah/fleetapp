"use server";

import { formTextValues } from "@fleetapp/core";

import { failedState, savedState, type ChangeFormState } from "../../components/change-form-state";
import { appDb } from "../../lib/app-db";
import { CARS_PATH, SETTINGS_PATH } from "../../lib/paths";
import { runUserChange } from "../../lib/run-change";
import { CAR_SETTINGS_FIELDS, carSettingsInputSchema } from "../../lib/settings/car-settings-input";
import { saveOperatorSettings } from "../../lib/settings/operator-settings";

export async function saveCarSettingsAction(
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = carSettingsInputSchema.safeParse(formTextValues(formData, CAR_SETTINGS_FIELDS));
  if (!parsed.success) {
    return failedState("That is not right, so nothing was saved. Check it and try again.");
  }
  return runUserChange({
    description: "Saving car settings",
    pagesToRefresh: [SETTINGS_PATH, CARS_PATH],
    change: async (actor) => {
      await saveOperatorSettings(appDb, actor, parsed.data);
      return savedState("Saved.");
    },
  });
}
