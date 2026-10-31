"use server";

import { isRecordId, UPLOAD_PROBLEM_MESSAGES } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";
import { z } from "zod";

import {
  ATTACHMENT_KINDS,
  removeAttachment,
  startAttachmentUpload,
} from "../../lib/files/attachments";
import {
  currentFileActor,
  fileDependencies,
  finishRecordUpload,
  plannedFileSchema,
  startRecordUpload,
  type RecordUploadStart,
} from "../../lib/files/file-action-support";
import { runUserChange } from "../../lib/run-change";

const NOT_FOUND_MESSAGE = "That record could not be found. It may have been removed or archived.";

const attachRequestSchema = plannedFileSchema.extend({
  target: z.object({ kind: z.enum(ATTACHMENT_KINDS), id: z.uuid() }),
});

export async function startAttachmentUploadAction(
  request: z.input<typeof attachRequestSchema>,
): Promise<RecordUploadStart> {
  const actor = await currentFileActor();
  const parsed = attachRequestSchema.safeParse(request);
  if (!parsed.success) {
    return { status: "refused", message: UPLOAD_PROBLEM_MESSAGES.type_not_allowed };
  }
  const { target, ...planned } = parsed.data;
  return startRecordUpload("Starting an attachment upload", NOT_FOUND_MESSAGE, () =>
    startAttachmentUpload(fileDependencies(), actor, target, planned),
  );
}

/** Null once attached; otherwise what to tell the person. The page refreshes itself. */
export async function finishAttachmentUploadAction(fileId: string): Promise<string | null> {
  return finishRecordUpload(
    "Finishing an attachment upload",
    await currentFileActor(),
    fileId,
    "vehicle_attachment",
  );
}

/** `pagePath` is the page showing it, refreshed afterwards. */
export async function removeAttachmentAction(
  pagePath: string,
  fileId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (!isRecordId(fileId)) {
    return failedState(NOT_FOUND_MESSAGE);
  }
  return runUserChange({
    description: "Removing an attachment",
    pagesToRefresh: [pagePath],
    change: async (actor) =>
      (await removeAttachment(fileDependencies(), actor, fileId)) === "removed"
        ? savedState("Removed.")
        : failedState("That file was already removed."),
  });
}
