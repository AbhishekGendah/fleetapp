import { formTextValues, isRecordId } from "@fleetapp/core";

import { CHOSEN_FIELD } from "@fleetapp/ui/choose-and-apply";
import {
  parsePolicyForm,
  parseRegoForm,
  POLICY_FORM_FIELDS,
  REGO_FORM_FIELDS,
} from "./paperwork-input";

/** The rego form as sent, checked with the same rules as in the browser. */
export function regoFromForm(formData: FormData): ReturnType<typeof parseRegoForm> {
  return parseRegoForm(formTextValues(formData, REGO_FORM_FIELDS));
}

export function policyFromForm(formData: FormData): ReturnType<typeof parsePolicyForm> {
  return parsePolicyForm(formTextValues(formData, POLICY_FORM_FIELDS));
}

/** The id picked in a "choose one" form, or null if it is not an id. */
export function chosenId(formData: FormData): string | null {
  const value = formData.get(CHOSEN_FIELD);
  return typeof value === "string" && isRecordId(value) ? value : null;
}

/** Every id ticked under this name; anything that is not an id is dropped. */
export function tickedIds(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .filter((value): value is string => typeof value === "string" && isRecordId(value));
}
