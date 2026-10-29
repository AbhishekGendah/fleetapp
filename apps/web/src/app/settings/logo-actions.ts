"use server";

import { FILE_PURPOSE_RULES, UPLOAD_PROBLEM_MESSAGES, describeErrorForLog } from "@fleetapp/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { appDb } from "../../lib/app-db";
import {
  confirmUpload,
  removeLogo,
  requestUpload,
  type FileDependencies,
} from "../../lib/files/stored-files";
import { HOME_PATH } from "../../lib/paths";
import { requireUser } from "../../lib/require-user";
import { appFileStorage } from "../../lib/storage/app-file-storage";
import type { UploadPermission } from "../../lib/storage/file-storage";

const UNEXPECTED_ERROR_MESSAGE = "The logo could not be saved. Try again in a moment.";
const WRONG_TYPE_MESSAGE = `That file is not ${FILE_PURPOSE_RULES.operator_logo.describedAs}.`;
const NOT_ARRIVED_MESSAGE = "The upload did not finish. Check your connection and try again.";

const logoRequestSchema = z.object({
  contentType: z.string().max(100),
  sizeBytes: z.number().int().nonnegative(),
});

function dependencies(): FileDependencies {
  return { database: appDb, storage: appFileStorage, now: () => new Date() };
}

/** The signed-in User and their Operator: never anything the browser sends (rule 1). */
async function currentActor() {
  const user = await requireUser();
  return { userId: user.id, operatorId: user.operatorId };
}

export type LogoUploadStart =
  | { status: "allowed"; fileId: string; permission: UploadPermission }
  | { status: "refused"; message: string };

export async function startLogoUploadAction(request: {
  contentType: string;
  sizeBytes: number;
}): Promise<LogoUploadStart> {
  const actor = await currentActor();
  const parsed = logoRequestSchema.safeParse(request);
  if (!parsed.success) {
    return { status: "refused", message: UPLOAD_PROBLEM_MESSAGES.type_not_allowed };
  }
  try {
    const result = await requestUpload(dependencies(), actor, {
      purpose: "operator_logo",
      ...parsed.data,
    });
    return result.status === "allowed"
      ? result
      : { status: "refused", message: UPLOAD_PROBLEM_MESSAGES[result.problem] };
  } catch (error) {
    console.error("Starting a logo upload failed", describeErrorForLog(error));
    return { status: "refused", message: UNEXPECTED_ERROR_MESSAGE };
  }
}

/** Null when the logo is saved; otherwise what to tell the person. */
export async function finishLogoUploadAction(fileId: string): Promise<string | null> {
  const actor = await currentActor();
  if (!z.uuid().safeParse(fileId).success) {
    return UNEXPECTED_ERROR_MESSAGE;
  }
  try {
    const result = await confirmUpload(dependencies(), actor, fileId);
    if (result === "confirmed") {
      // The logo is in the header of every page.
      revalidatePath(HOME_PATH, "layout");
      return null;
    }
    return result === "wrong_type"
      ? WRONG_TYPE_MESSAGE
      : result === "not_arrived"
        ? NOT_ARRIVED_MESSAGE
        : UNEXPECTED_ERROR_MESSAGE;
  } catch (error) {
    console.error("Finishing a logo upload failed", describeErrorForLog(error));
    return UNEXPECTED_ERROR_MESSAGE;
  }
}

export async function removeLogoAction(): Promise<void> {
  const actor = await currentActor();
  await removeLogo(dependencies(), actor);
  // The logo is in the header of every page.
  revalidatePath(HOME_PATH, "layout");
}
