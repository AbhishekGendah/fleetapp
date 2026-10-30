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
  finishMessage,
  orUploadFailed,
  plannedFileSchema,
  refusedMessage,
  UPLOAD_FAILED_MESSAGE,
} from "../../lib/files/file-action-support";
import { confirmUpload } from "../../lib/files/stored-files";
import { runUserChange } from "../../lib/run-change";
import type { UploadPermission } from "../../lib/storage/file-storage";

const NOT_FOUND_MESSAGE = "That record could not be found. It may have been removed or archived.";

const attachRequestSchema = plannedFileSchema.extend({
  target: z.object({ kind: z.enum(ATTACHMENT_KINDS), id: z.uuid() }),
});

export type AttachmentUploadStart =
  | { status: "allowed"; fileId: string; permission: UploadPermission }
  | { status: "refused"; message: string };

export async function startAttachmentUploadAction(
  request: z.input<typeof attachRequestSchema>,
): Promise<AttachmentUploadStart> {
  const actor = await currentFileActor();
  const parsed = attachRequestSchema.safeParse(request);
  if (!parsed.success) {
    return { status: "refused", message: UPLOAD_PROBLEM_MESSAGES.type_not_allowed };
  }
  const { target, ...planned } = parsed.data;
  return orUploadFailed(
    "Starting an attachment upload",
    async (): Promise<AttachmentUploadStart> => {
      const result = await startAttachmentUpload(fileDependencies(), actor, target, planned);
      if (result.status === "not_found") {
        return { status: "refused", message: NOT_FOUND_MESSAGE };
      }
      return result.status === "refused"
        ? { status: "refused", message: refusedMessage(result) }
        : { status: "allowed", fileId: result.fileId, permission: result.permission };
    },
    { status: "refused", message: UPLOAD_FAILED_MESSAGE },
  );
}

/** Null once attached; otherwise what to tell the person. The page refreshes itself. */
export async function finishAttachmentUploadAction(fileId: string): Promise<string | null> {
  const actor = await currentFileActor();
  if (!isRecordId(fileId)) {
    return UPLOAD_FAILED_MESSAGE;
  }
  return orUploadFailed(
    "Finishing an attachment upload",
    async () =>
      finishMessage(await confirmUpload(fileDependencies(), actor, fileId), "vehicle_attachment"),
    UPLOAD_FAILED_MESSAGE,
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
