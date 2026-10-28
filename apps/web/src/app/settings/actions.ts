"use server";

import { revalidatePath } from "next/cache";

import { appDb } from "../../lib/app-db";
import { HOME_PATH, SETTINGS_PATH } from "../../lib/paths";
import { requireUser } from "../../lib/require-user";
import { saveBusinessDetails } from "../../lib/settings/business-details";
import {
  parseBusinessDetailsForm,
  type BusinessDetailsFormValues,
} from "../../lib/settings/business-details-input";
import {
  BUSINESS_DETAIL_TEXT_FIELDS,
  type BusinessDetailsFormState,
} from "./business-details-form-state";

const UNEXPECTED_ERROR_MESSAGE = "Something went wrong and nothing was saved. Try again.";
// The browser runs the same checks first, so this is only reached by a
// request that skipped them.
const INVALID_MESSAGE =
  "Some details are not right, so nothing was saved. Check them and try again.";

function submittedValues(formData: FormData): BusinessDetailsFormValues {
  return Object.fromEntries(
    BUSINESS_DETAIL_TEXT_FIELDS.map((name) => {
      const value = formData.get(name);
      return [name, typeof value === "string" ? value : ""];
    }),
  ) as BusinessDetailsFormValues;
}

export async function saveBusinessDetailsAction(
  _previous: BusinessDetailsFormState,
  formData: FormData,
): Promise<BusinessDetailsFormState> {
  const user = await requireUser();

  const parsed = parseBusinessDetailsForm(
    submittedValues(formData),
    formData.get("gstRegistered") === "on",
  );
  if (!parsed.success) {
    return { status: "failed", formError: INVALID_MESSAGE };
  }

  try {
    const result = await saveBusinessDetails(
      appDb,
      { userId: user.id, operatorId: user.operatorId },
      parsed.data,
    );
    revalidatePath(SETTINGS_PATH);
    revalidatePath(HOME_PATH);
    return { status: "saved", hasPostcodeWarning: result.hasPostcodeWarning };
  } catch (error) {
    console.error("Saving business details failed", error);
    return { status: "failed", formError: UNEXPECTED_ERROR_MESSAGE };
  }
}
