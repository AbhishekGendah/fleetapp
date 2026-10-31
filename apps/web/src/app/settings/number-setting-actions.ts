"use server";

import { formTextValues } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";

import { appDb } from "../../lib/app-db";
import { CARS_PATH, RENTERS_PATH, SETTINGS_PATH } from "../../lib/paths";
import { runUserChange } from "../../lib/run-change";
import { saveOperatorSettings } from "../../lib/settings/operator-settings";
import {
  NUMBER_SETTING_FIELDS,
  numberSettingInputSchema,
  isNumberSetting,
} from "../../lib/settings/number-setting-input";

const INVALID_MESSAGE = "That is not right, so nothing was saved. Check it and try again.";

/** Bound to one setting by its form; checked against the known settings on save. */
export async function saveNumberSettingAction(
  setting: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  if (!isNumberSetting(setting)) {
    return failedState(INVALID_MESSAGE);
  }
  const parsed = numberSettingInputSchema(setting).safeParse(
    formTextValues(formData, NUMBER_SETTING_FIELDS),
  );
  if (!parsed.success) {
    return failedState(INVALID_MESSAGE);
  }
  return runUserChange({
    description: "Saving a number setting",
    pagesToRefresh: [SETTINGS_PATH, CARS_PATH, RENTERS_PATH],
    change: async (actor) => {
      await saveOperatorSettings(appDb, actor, { [setting]: parsed.data.amount });
      return savedState("Saved.");
    },
  });
}
