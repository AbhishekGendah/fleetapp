"use server";

import { formTextValues } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";

import { appDb } from "../../lib/app-db";
import { CARS_PATH, RENTERS_PATH, SETTINGS_PATH } from "../../lib/paths";
import { runUserChange } from "../../lib/run-change";
import { saveOperatorSettings } from "../../lib/settings/operator-settings";
import { DAYS_FIELDS, daysInputSchema, isDaysSetting } from "../../lib/settings/days-setting-input";

const INVALID_MESSAGE = "That is not right, so nothing was saved. Check it and try again.";

/** Bound to one setting by its form; checked against the known settings on save. */
export async function saveDaysSettingAction(
  setting: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  if (!isDaysSetting(setting)) {
    return failedState(INVALID_MESSAGE);
  }
  const parsed = daysInputSchema(setting).safeParse(formTextValues(formData, DAYS_FIELDS));
  if (!parsed.success) {
    return failedState(INVALID_MESSAGE);
  }
  return runUserChange({
    description: "Saving a days setting",
    pagesToRefresh: [SETTINGS_PATH, CARS_PATH, RENTERS_PATH],
    change: async (actor) => {
      await saveOperatorSettings(appDb, actor, { [setting]: parsed.data.days });
      return savedState("Saved.");
    },
  });
}
