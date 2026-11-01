"use server";

import { formTextValues } from "@fleetapp/core";
import { failedState, savedState } from "@fleetapp/ui/change-form-state";

import { appDb } from "../../lib/app-db";
import { CARS_PATH, RENTERS_PATH, SETTINGS_PATH } from "../../lib/paths";
import { runUserChange } from "../../lib/run-change";
import { countScansDueWith, NO_HOLDS_YET } from "../../lib/renters/scan-retention";
import { requireUser } from "../../lib/require-user";
import { loadOperatorSettings, saveOperatorSettings } from "../../lib/settings/operator-settings";
import {
  NUMBER_SETTING_FIELDS,
  numberSettingInputSchema,
  isNumberSetting,
} from "../../lib/settings/number-setting-input";
import { CONFIRMED_AMOUNT_FIELD, type NumberSettingState } from "./number-setting-state";

const INVALID_MESSAGE = "That is not right, so nothing was saved. Check it and try again.";

/**
 * Lowering how long licence scans are kept bins every older scan that night:
 * the first Save says how many, and only a second Save of the same number
 * goes ahead. Null when there is nothing to ask.
 */
async function askBeforeBinningScans(
  operatorId: string,
  amount: number,
  formData: FormData,
): Promise<NumberSettingState | null> {
  if (formData.get(CONFIRMED_AMOUNT_FIELD) === String(amount)) {
    return null;
  }
  const settings = await loadOperatorSettings(appDb, operatorId);
  if (amount >= settings.licenceScanKeptMonths) {
    return null;
  }
  // TODO(Phase 3): pass the rentals' holds, as the nightly job will.
  const count = await countScansDueWith(appDb, operatorId, amount, new Date(), NO_HOLDS_YET);
  if (count === 0) {
    return null;
  }
  return {
    status: "confirm",
    amount: String(amount),
    message: `With ${amount} ${amount === 1 ? "month" : "months"}, ${count} licence ${count === 1 ? "scan" : "scans"} will be deleted tonight (they can be got back for 30 days). Press Save again to go ahead.`,
  };
}

/** Bound to one setting by its form; checked against the known settings on save. */
export async function saveNumberSettingAction(
  setting: string,
  _previous: NumberSettingState,
  formData: FormData,
): Promise<NumberSettingState> {
  if (!isNumberSetting(setting)) {
    return failedState(INVALID_MESSAGE);
  }
  const parsed = numberSettingInputSchema(setting).safeParse(
    formTextValues(formData, NUMBER_SETTING_FIELDS),
  );
  if (!parsed.success) {
    return failedState(INVALID_MESSAGE);
  }
  const { amount } = parsed.data;
  if (setting === "licenceScanKeptMonths") {
    const user = await requireUser();
    const question = await askBeforeBinningScans(user.operatorId, amount, formData);
    if (question) {
      return question;
    }
  }
  return runUserChange({
    description: "Saving a number setting",
    pagesToRefresh: [SETTINGS_PATH, CARS_PATH, RENTERS_PATH],
    change: async (actor) => {
      await saveOperatorSettings(appDb, actor, { [setting]: amount });
      return savedState("Saved.");
    },
  });
}
