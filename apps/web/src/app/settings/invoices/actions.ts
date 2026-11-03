"use server";

import { formTextValues, NUMBERING_SERIES, type NumberingSeries } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";

import { appDb } from "../../../lib/app-db";
import { HOW_TO_PAY_FIELDS, howToPayInputSchema } from "../../../lib/billing/how-to-pay-input";
import { saveNumbering } from "../../../lib/billing/numbering";
import { NUMBERING_FIELDS, numberingInputSchema } from "../../../lib/billing/numbering-input";
import { INVOICE_SETTINGS_PATH } from "../../../lib/paths";
import { runUserChange } from "../../../lib/run-change";
import { saveOperatorSettings } from "../../../lib/settings/operator-settings";

const CHECK_MESSAGE = "Check the boxes marked in red, then try again.";

function isSeries(value: string): value is NumberingSeries {
  return (NUMBERING_SERIES as readonly string[]).includes(value);
}

/** Bound to one series by its form: the prefix, and the next number until the first is issued. */
export async function saveNumberingAction(
  series: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = numberingInputSchema.safeParse(formTextValues(formData, NUMBERING_FIELDS));
  if (!isSeries(series)) {
    return failedState("That numbering could not be found.");
  }
  if (!parsed.success) {
    return failedState(CHECK_MESSAGE);
  }
  return runUserChange({
    description: "Saving invoice numbering",
    pagesToRefresh: [INVOICE_SETTINGS_PATH],
    change: async (actor) =>
      (await saveNumbering(appDb, actor, series, parsed.data)) === "saved"
        ? savedState("Saved. The next one issued uses it.")
        : failedState(
            "The first one has been issued, so the next number can no longer change: it would leave a gap or repeat a number. The prefix can still change.",
          ),
  });
}

/** What every invoice says about paying, e.g. the business's bank details. */
export async function saveHowToPayAction(
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = howToPayInputSchema.safeParse(formTextValues(formData, HOW_TO_PAY_FIELDS));
  if (!parsed.success) {
    return failedState(CHECK_MESSAGE);
  }
  return runUserChange({
    description: "Saving how to pay",
    pagesToRefresh: [INVOICE_SETTINGS_PATH],
    change: async (actor) => {
      await saveOperatorSettings(appDb, actor, { howToPay: parsed.data.howToPay });
      return savedState("Saved. Invoices issued from now print it.");
    },
  });
}
