"use server";

import { formTextValues } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";

import { appDb } from "../../lib/app-db";
import { RENTALS_PATH, SETTINGS_PATH } from "../../lib/paths";
import { runUserChange } from "../../lib/run-change";
import {
  CHOICE_SETTING_FIELDS,
  choiceSettingInputSchema,
  isChoiceSetting,
} from "../../lib/settings/choice-setting-input";
import { saveOperatorSettings } from "../../lib/settings/operator-settings";

const INVALID_MESSAGE = "That is not one of the choices, so nothing was saved. Try again.";

/** Bound to one setting by its form; checked against the known settings and options on save. */
export async function saveChoiceSettingAction(
  setting: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  if (!isChoiceSetting(setting)) {
    return failedState(INVALID_MESSAGE);
  }
  const parsed = choiceSettingInputSchema(setting).safeParse(
    formTextValues(formData, CHOICE_SETTING_FIELDS),
  );
  if (!parsed.success) {
    return failedState(INVALID_MESSAGE);
  }
  return runUserChange({
    description: "Saving a choice setting",
    pagesToRefresh: [SETTINGS_PATH, RENTALS_PATH],
    change: async (actor) => {
      await saveOperatorSettings(appDb, actor, { [setting]: parsed.data.choice });
      return savedState("Saved. New rentals use this; rentals already made keep theirs.");
    },
  });
}
