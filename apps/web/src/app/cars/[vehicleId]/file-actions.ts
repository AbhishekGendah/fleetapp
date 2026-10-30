"use server";

import { isRecordId, requiredLine, UPLOAD_PROBLEM_MESSAGES } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  removeCarFile,
  startCarDocumentUpload,
  startCarPhotoUpload,
} from "../../../lib/files/car-files";
import {
  currentFileActor,
  fileDependencies,
  finishMessage,
  orUploadFailed,
  plannedFileSchema,
  refusedMessage,
  UPLOAD_FAILED_MESSAGE,
} from "../../../lib/files/file-action-support";
import { confirmUpload } from "../../../lib/files/stored-files";
import { carPath } from "../../../lib/paths";
import type { UploadPermission } from "../../../lib/storage/file-storage";
import { changeCar, NOT_FOUND_MESSAGE } from "./change-car";

interface AllowedUpload {
  fileId: string;
  permission: UploadPermission;
}

export type CarPhotoUploadStart =
  | { status: "allowed"; photo: AllowedUpload; thumbnail: AllowedUpload }
  | { status: "refused"; message: string };

export type CarDocumentUploadStart =
  ({ status: "allowed" } & AllowedUpload) | { status: "refused"; message: string };

const REFUSED = { status: "refused", message: UPLOAD_FAILED_MESSAGE } as const;
const NOT_A_CAR = { status: "refused", message: NOT_FOUND_MESSAGE } as const;

const photoRequestSchema = z.object({ photo: plannedFileSchema, thumbnail: plannedFileSchema });
const documentRequestSchema = plannedFileSchema.extend({ label: requiredLine });

export async function startCarPhotoUploadAction(
  vehicleId: string,
  request: z.input<typeof photoRequestSchema>,
): Promise<CarPhotoUploadStart> {
  const actor = await currentFileActor();
  const parsed = photoRequestSchema.safeParse(request);
  if (!isRecordId(vehicleId) || !parsed.success) {
    return { status: "refused", message: UPLOAD_PROBLEM_MESSAGES.type_not_allowed };
  }
  return orUploadFailed(
    "Starting a car photo upload",
    async (): Promise<CarPhotoUploadStart> => {
      const result = await startCarPhotoUpload(fileDependencies(), actor, vehicleId, parsed.data);
      if (result.status === "not_found") {
        return NOT_A_CAR;
      }
      return result.status === "refused"
        ? { status: "refused", message: refusedMessage(result) }
        : { status: "allowed", photo: result.photo, thumbnail: result.thumbnail };
    },
    REFUSED,
  );
}

/** Null once the photo is saved; otherwise what to tell the person. */
export async function finishCarPhotoUploadAction(
  vehicleId: string,
  photoId: string,
  thumbnailId: string,
): Promise<string | null> {
  const actor = await currentFileActor();
  if (!isRecordId(vehicleId) || !isRecordId(photoId) || !isRecordId(thumbnailId)) {
    return UPLOAD_FAILED_MESSAGE;
  }
  return orUploadFailed(
    "Finishing a car photo upload",
    async () => {
      const deps = fileDependencies();
      const problem = finishMessage(await confirmUpload(deps, actor, photoId), "vehicle_photo");
      if (!problem) {
        // A missing small copy only means the grid shows the photo itself.
        await confirmUpload(deps, actor, thumbnailId);
        revalidatePath(carPath(vehicleId));
      }
      return problem;
    },
    UPLOAD_FAILED_MESSAGE,
  );
}

export async function startCarDocumentUploadAction(
  vehicleId: string,
  request: z.input<typeof documentRequestSchema>,
): Promise<CarDocumentUploadStart> {
  const actor = await currentFileActor();
  const parsed = documentRequestSchema.safeParse(request);
  if (!isRecordId(vehicleId) || !parsed.success) {
    return { status: "refused", message: UPLOAD_PROBLEM_MESSAGES.type_not_allowed };
  }
  return orUploadFailed(
    "Starting a car document upload",
    async (): Promise<CarDocumentUploadStart> => {
      const result = await startCarDocumentUpload(
        fileDependencies(),
        actor,
        vehicleId,
        parsed.data,
      );
      if (result.status === "not_found") {
        return NOT_A_CAR;
      }
      return result.status === "refused"
        ? { status: "refused", message: refusedMessage(result) }
        : { status: "allowed", fileId: result.fileId, permission: result.permission };
    },
    REFUSED,
  );
}

export async function finishCarDocumentUploadAction(
  vehicleId: string,
  fileId: string,
): Promise<string | null> {
  const actor = await currentFileActor();
  if (!isRecordId(vehicleId) || !isRecordId(fileId)) {
    return UPLOAD_FAILED_MESSAGE;
  }
  return orUploadFailed(
    "Finishing a car document upload",
    async () => {
      const problem = finishMessage(
        await confirmUpload(fileDependencies(), actor, fileId),
        "vehicle_document",
      );
      if (!problem) {
        revalidatePath(carPath(vehicleId));
      }
      return problem;
    },
    UPLOAD_FAILED_MESSAGE,
  );
}

export async function removeCarFileAction(
  vehicleId: string,
  fileId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (!isRecordId(fileId)) {
    return failedState(NOT_FOUND_MESSAGE);
  }
  return changeCar(vehicleId, "Removing a car file", async (actor) =>
    (await removeCarFile(fileDependencies(), actor, vehicleId, fileId)) === "removed"
      ? savedState("Removed.")
      : failedState("That file was already removed."),
  );
}
