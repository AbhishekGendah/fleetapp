"use server";

import { isRecordId, UPLOAD_PROBLEM_MESSAGES } from "@fleetapp/core";
import { revalidatePath } from "next/cache";

import {
  currentFileActor,
  fileDependencies,
  finishMessage,
  orUploadFailed,
  plannedFileSchema,
  refusedMessage,
  UPLOAD_FAILED_MESSAGE,
} from "../../lib/files/file-action-support";
import { confirmUpload, removeLogo, requestUpload } from "../../lib/files/stored-files";
import { HOME_PATH } from "../../lib/paths";
import type { UploadPermission } from "../../lib/storage/file-storage";

export type LogoUploadStart =
  | { status: "allowed"; fileId: string; permission: UploadPermission }
  | { status: "refused"; message: string };

export async function startLogoUploadAction(request: {
  contentType: string;
  sizeBytes: number;
}): Promise<LogoUploadStart> {
  const actor = await currentFileActor();
  const parsed = plannedFileSchema.safeParse(request);
  if (!parsed.success) {
    return { status: "refused", message: UPLOAD_PROBLEM_MESSAGES.type_not_allowed };
  }
  return orUploadFailed(
    "Starting a logo upload",
    async (): Promise<LogoUploadStart> => {
      const result = await requestUpload(fileDependencies(), actor, {
        purpose: "operator_logo",
        ...parsed.data,
      });
      return result.status === "allowed"
        ? result
        : { status: "refused", message: refusedMessage(result) };
    },
    { status: "refused", message: UPLOAD_FAILED_MESSAGE },
  );
}

/** Null when the logo is saved; otherwise what to tell the person. */
export async function finishLogoUploadAction(fileId: string): Promise<string | null> {
  const actor = await currentFileActor();
  if (!isRecordId(fileId)) {
    return UPLOAD_FAILED_MESSAGE;
  }
  return orUploadFailed(
    "Finishing a logo upload",
    async () => {
      const problem = finishMessage(
        await confirmUpload(fileDependencies(), actor, fileId),
        "operator_logo",
      );
      if (!problem) {
        // The logo is in the header of every page.
        revalidatePath(HOME_PATH, "layout");
      }
      return problem;
    },
    UPLOAD_FAILED_MESSAGE,
  );
}

export async function removeLogoAction(): Promise<void> {
  const actor = await currentFileActor();
  await removeLogo(fileDependencies(), actor);
  // The logo is in the header of every page.
  revalidatePath(HOME_PATH, "layout");
}
