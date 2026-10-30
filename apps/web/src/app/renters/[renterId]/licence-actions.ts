"use server";

import { formTextValues, isRecordId, LICENCE_SIDES, UPLOAD_PROBLEM_MESSAGES } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";
import { z } from "zod";

import { appDb } from "../../../lib/app-db";
import {
  currentFileActor,
  fileDependencies,
  finishRecordUpload,
  plannedFileSchema,
  startRecordUpload,
  type RecordUploadStart,
} from "../../../lib/files/file-action-support";
import { renterPath, RENTERS_PATH } from "../../../lib/paths";
import { LICENCE_FORM_FIELDS, parseLicenceForm } from "../../../lib/renters/licence-input";
import { saveLicence } from "../../../lib/renters/licence-records";
import { removeLicenceScan, startLicenceScanUpload } from "../../../lib/renters/licence-scans";
import { runUserChange } from "../../../lib/run-change";
import { RENTER_NOT_FOUND_MESSAGE } from "../renter-form-state";

const INVALID_MESSAGE =
  "Some details are not right, so nothing was saved. Check them and try again.";

function licenceOnFileMessage(isArchived: boolean): string {
  return isArchived
    ? "Another Renter, now archived, already has this licence. Restore them rather than adding the same person twice."
    : "Another Renter already has this licence. It may be the same person entered twice.";
}

export async function saveLicenceAction(
  renterId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = parseLicenceForm(formTextValues(formData, LICENCE_FORM_FIELDS));
  if (!isRecordId(renterId)) {
    return failedState(RENTER_NOT_FOUND_MESSAGE);
  }
  if (!parsed.success) {
    return failedState(INVALID_MESSAGE);
  }
  return runUserChange({
    description: "Saving a licence",
    pagesToRefresh: [renterPath(renterId), RENTERS_PATH],
    change: async (actor) => {
      const result = await saveLicence(appDb, actor, renterId, parsed.data);
      if (typeof result === "object") {
        return failedState(
          licenceOnFileMessage(result.isArchived),
          result.renterId ? { href: renterPath(result.renterId), label: "Open them" } : undefined,
        );
      }
      return result === "not_found"
        ? failedState(RENTER_NOT_FOUND_MESSAGE)
        : savedState("Licence saved.");
    },
  });
}

const scanRequestSchema = plannedFileSchema.extend({
  renterId: z.uuid(),
  side: z.enum(LICENCE_SIDES),
});

export async function startLicenceScanUploadAction(
  request: z.input<typeof scanRequestSchema>,
): Promise<RecordUploadStart> {
  const actor = await currentFileActor();
  const parsed = scanRequestSchema.safeParse(request);
  if (!parsed.success) {
    return { status: "refused", message: UPLOAD_PROBLEM_MESSAGES.type_not_allowed };
  }
  const { renterId, side, ...planned } = parsed.data;
  return startRecordUpload("Starting a licence scan upload", RENTER_NOT_FOUND_MESSAGE, () =>
    startLicenceScanUpload(fileDependencies(), actor, renterId, side, planned),
  );
}

/** Null once saved (replacing that side's old scan); otherwise what to tell the person. */
export async function finishLicenceScanUploadAction(fileId: string): Promise<string | null> {
  return finishRecordUpload("Finishing a licence scan upload", fileId, "renter_licence_scan");
}

export async function removeLicenceScanAction(
  renterId: string,
  fileId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (!isRecordId(renterId) || !isRecordId(fileId)) {
    return failedState(RENTER_NOT_FOUND_MESSAGE);
  }
  return runUserChange({
    description: "Removing a licence scan",
    pagesToRefresh: [renterPath(renterId)],
    change: async (actor) =>
      (await removeLicenceScan(fileDependencies(), actor, renterId, fileId)) === "removed"
        ? savedState("Removed.")
        : failedState("That scan was already removed."),
  });
}
