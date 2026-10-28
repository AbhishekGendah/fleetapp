"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { appDb } from "../../lib/app-db";
import { HOME_PATH, SETTINGS_PATH } from "../../lib/paths";
import { requireUser } from "../../lib/require-user";
import { saveBusinessDetails } from "../../lib/settings/business-details";
import { businessDetailsInputSchema } from "../../lib/settings/business-details-input";
import {
  BUSINESS_DETAIL_TEXT_FIELDS,
  type BusinessDetailsFormState,
} from "./business-details-form-state";

const UNEXPECTED_ERROR_MESSAGE = "Something went wrong and nothing was saved. Try again.";

/** What was typed, so a refused form comes back filled in rather than empty. */
function submittedValues(formData: FormData): Record<string, string> {
  return Object.fromEntries(
    BUSINESS_DETAIL_TEXT_FIELDS.map((name) => {
      const value = formData.get(name);
      return [name, typeof value === "string" ? value : ""];
    }),
  );
}

export async function saveBusinessDetailsAction(
  _previous: BusinessDetailsFormState,
  formData: FormData,
): Promise<BusinessDetailsFormState> {
  const user = await requireUser();

  const values = submittedValues(formData);
  const isGstRegistered = formData.get("gstRegistered") === "on";
  const parsed = businessDetailsInputSchema.safeParse({
    ...values,
    state: values.state || null,
    gstRegistered: isGstRegistered,
    gstRegisteredFrom: isGstRegistered ? values.gstRegisteredFrom : "",
  });
  if (!parsed.success) {
    return {
      status: "invalid",
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
      values,
      isGstRegistered,
    };
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
    return { status: "failed", formError: UNEXPECTED_ERROR_MESSAGE, values, isGstRegistered };
  }
}
