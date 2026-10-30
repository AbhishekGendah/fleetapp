import {
  describeErrorForLog,
  FILE_PURPOSE_RULES,
  isRecordId,
  UPLOAD_PROBLEM_MESSAGES,
  type FilePurpose,
} from "@fleetapp/core";
import { z } from "zod";

import { appDb } from "../app-db";
import { requireUser } from "../require-user";
import { appFileStorage } from "../storage/app-file-storage";
import type { UploadPermission } from "../storage/file-storage";
import {
  confirmUpload,
  type ConfirmResult,
  type FileActor,
  type FileDependencies,
  type UploadRequestResult,
} from "./stored-files";

/** What the upload actions share: their dependencies, who is acting, and what to say. */

export const UPLOAD_FAILED_MESSAGE = "The file could not be saved. Try again in a moment.";
export const NOT_ARRIVED_MESSAGE =
  "The upload did not finish. Check your connection and try again.";

/** What the browser says it is about to send; checked again once it arrives (rule 22). */
export const plannedFileSchema = z.object({
  contentType: z.string().max(100),
  sizeBytes: z.number().int().nonnegative(),
});

export function fileDependencies(): FileDependencies {
  return { database: appDb, storage: appFileStorage, now: () => new Date() };
}

/** The signed-in User and their Operator: never anything the browser sends (rule 1). */
export async function currentFileActor(): Promise<FileActor> {
  const user = await requireUser();
  return { userId: user.id, operatorId: user.operatorId };
}

/** A refusal in words for the person. */
export function refusedMessage(
  result: Extract<UploadRequestResult, { status: "refused" }>,
): string {
  return UPLOAD_PROBLEM_MESSAGES[result.problem];
}

/** Null when saved; otherwise what to tell the person. */
export function finishMessage(result: ConfirmResult, purpose: FilePurpose): string | null {
  if (result === "confirmed") {
    return null;
  }
  if (result === "wrong_type") {
    return `That file is not ${FILE_PURPOSE_RULES[purpose].describedAs}.`;
  }
  return result === "not_arrived" ? NOT_ARRIVED_MESSAGE : UPLOAD_FAILED_MESSAGE;
}

/** Runs an upload step, turning anything unexpected into a message without its details. */
export async function orUploadFailed<Result>(
  description: string,
  step: () => Promise<Result>,
  failed: Result,
): Promise<Result> {
  try {
    return await step();
  } catch (error) {
    console.error(`${description} failed`, describeErrorForLog(error));
    return failed;
  }
}

/** What the browser gets back when it asks to send a file to a record. */
export type RecordUploadStart =
  | { status: "allowed"; fileId: string; permission: UploadPermission }
  | { status: "refused"; message: string };

/**
 * Step one of sending a file to a record (an attachment, a licence scan):
 * the record may be gone or not the Operator's, the file may be refused.
 */
export function startRecordUpload(
  description: string,
  notFoundMessage: string,
  start: () => Promise<UploadRequestResult | { status: "not_found" }>,
): Promise<RecordUploadStart> {
  return orUploadFailed(
    description,
    async (): Promise<RecordUploadStart> => {
      const result = await start();
      if (result.status === "not_found") {
        return { status: "refused", message: notFoundMessage };
      }
      return result.status === "refused"
        ? { status: "refused", message: refusedMessage(result) }
        : { status: "allowed", fileId: result.fileId, permission: result.permission };
    },
    { status: "refused", message: UPLOAD_FAILED_MESSAGE },
  );
}

/** Step two: null once saved; otherwise what to tell the person. */
export async function finishRecordUpload(
  description: string,
  fileId: string,
  purpose: FilePurpose,
): Promise<string | null> {
  const actor = await currentFileActor();
  if (!isRecordId(fileId)) {
    return UPLOAD_FAILED_MESSAGE;
  }
  return orUploadFailed(
    description,
    async () => finishMessage(await confirmUpload(fileDependencies(), actor, fileId), purpose),
    UPLOAD_FAILED_MESSAGE,
  );
}
