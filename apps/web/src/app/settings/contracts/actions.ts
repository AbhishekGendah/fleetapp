"use server";

import { describeErrorForLog, formTextValues, isRecordId } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { appDb } from "../../../lib/app-db";
import {
  NEW_TEMPLATE_FIELDS,
  newTemplateInputSchema,
  TEMPLATE_EDIT_FIELDS,
  templateEditInputSchema,
} from "../../../lib/contracts/template-input";
import {
  archiveTemplate,
  createTemplate,
  makeTemplateDefault,
  saveTemplate,
} from "../../../lib/contracts/templates";
import { contractTemplatePath, CONTRACTS_PATH } from "../../../lib/paths";
import { requireUser } from "../../../lib/require-user";
import { runUserChange } from "../../../lib/run-change";

const INVALID_MESSAGE =
  "Some details are not right, so nothing was saved. Check them and try again.";
const NOT_FOUND_MESSAGE = "That template could not be found. It may have been archived.";

/** Adds a template from the starter layout and opens it in the editor. */
export async function addTemplateAction(
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const user = await requireUser();
  const parsed = newTemplateInputSchema.safeParse(formTextValues(formData, NEW_TEMPLATE_FIELDS));
  if (!parsed.success) {
    return failedState(INVALID_MESSAGE);
  }
  let templateId: string;
  try {
    templateId = await createTemplate(
      appDb,
      { userId: user.id, operatorId: user.operatorId },
      parsed.data,
    );
  } catch (error) {
    console.error("Adding a contract template failed", describeErrorForLog(error));
    return failedState("Something went wrong and nothing was saved. Try again.");
  }
  revalidatePath(CONTRACTS_PATH);
  // Outside the try: Next carries out a redirect by throwing.
  redirect(contractTemplatePath(templateId));
}

/** Bound to one template: saves its name and text, a changed text becoming the next version. */
export async function saveTemplateAction(
  templateId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = templateEditInputSchema.safeParse(formTextValues(formData, TEMPLATE_EDIT_FIELDS));
  if (!isRecordId(templateId) || !parsed.success) {
    return failedState(
      parsed.success ? NOT_FOUND_MESSAGE : (parsed.error.issues[0]?.message ?? INVALID_MESSAGE),
    );
  }
  return runUserChange({
    description: "Saving a contract template",
    pagesToRefresh: [CONTRACTS_PATH, contractTemplatePath(templateId)],
    change: async (actor) => {
      const result = await saveTemplate(appDb, actor, templateId, parsed.data);
      if (result === "not_found") {
        return failedState(NOT_FOUND_MESSAGE);
      }
      return savedState(
        result === "unchanged"
          ? "Nothing had changed."
          : "Saved as a new version. Anything already signed keeps the version it used.",
      );
    },
  });
}

export async function makeTemplateDefaultAction(
  templateId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (!isRecordId(templateId)) {
    return failedState(NOT_FOUND_MESSAGE);
  }
  return runUserChange({
    description: "Making a contract template the default",
    pagesToRefresh: [CONTRACTS_PATH, contractTemplatePath(templateId)],
    change: async (actor) =>
      (await makeTemplateDefault(appDb, actor, templateId)) === "not_found"
        ? failedState(NOT_FOUND_MESSAGE)
        : savedState("New rentals now use this template."),
  });
}

export async function archiveTemplateAction(
  templateId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (!isRecordId(templateId)) {
    return failedState(NOT_FOUND_MESSAGE);
  }
  return runUserChange({
    description: "Archiving a contract template",
    pagesToRefresh: [CONTRACTS_PATH, contractTemplatePath(templateId)],
    change: async (actor) => {
      const result = await archiveTemplate(appDb, actor, templateId);
      if (result === "is_default") {
        return failedState("Make another template the default first: new rentals use this one.");
      }
      return result === "not_found"
        ? failedState(NOT_FOUND_MESSAGE)
        : savedState("Archived. Contracts already issued from it are kept.");
    },
  });
}
