"use server";

import { formTextValues } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";

import { appDb } from "../../lib/app-db";
import { CARS_PATH, RENTERS_PATH, SETTINGS_PATH } from "../../lib/paths";
import { runUserChange } from "../../lib/run-change";
import { saveOperatorSettings } from "../../lib/settings/operator-settings";
import {
  isWarningDaysSetting,
  WARNING_DAYS_FIELDS,
  warningDaysInputSchema,
} from "../../lib/settings/warning-days-input";

const INVALID_MESSAGE = "That is not right, so nothing was saved. Check it and try again.";

/** Bound to one setting by its form; checked against the known settings on save. */
export async function saveWarningDaysAction(
  setting: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = warningDaysInputSchema.safeParse(formTextValues(formData, WARNING_DAYS_FIELDS));
  if (!isWarningDaysSetting(setting) || !parsed.success) {
    return failedState(INVALID_MESSAGE);
  }
  return runUserChange({
    description: "Saving a Due soon setting",
    pagesToRefresh: [SETTINGS_PATH, CARS_PATH, RENTERS_PATH],
    change: async (actor) => {
      await saveOperatorSettings(appDb, actor, { [setting]: parsed.data.days });
      return savedState("Saved.");
    },
  });
}
