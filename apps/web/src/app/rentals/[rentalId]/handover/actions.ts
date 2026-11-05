"use server";

import {
  damageMarkInputSchema,
  formatKilometres,
  describeErrorForLog,
  isRecordId,
  optionalLine,
  UPLOAD_PROBLEM_MESSAGES,
} from "@fleetapp/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  OVERRIDE_REASON_FIELDS,
  type OverrideReasonField,
} from "../../../../lib/handover/override-reasons";

import { appDb } from "../../../../lib/app-db";
import { appEmailSender } from "../../../../lib/email-sender";
import { canHearRenterPayments } from "../../../../lib/payments/app-payments";
import {
  fileDependencies,
  finishMessage,
  orUploadFailed,
  plannedFileSchema,
  refusedMessage,
  UPLOAD_FAILED_MESSAGE,
} from "../../../../lib/files/file-action-support";
import { confirmUpload } from "../../../../lib/files/stored-files";
import { completeHandover } from "../../../../lib/handover/complete-handover";
import { renterSignatureFrom } from "../../../../lib/handover/renter-signature-form";
import { handoverDetailsFormSchema } from "../../../../lib/handover/handover-input";
import { startChecklistPhotoUpload } from "../../../../lib/handover/handover-photos";
import {
  addDamageMark,
  cancelHandover,
  removeDamageMark,
  saveHandoverDetails,
  startHandover,
} from "../../../../lib/handover/handover-records";
import { rentalHandoverPath, rentalPath } from "../../../../lib/paths";
import { requireUser } from "../../../../lib/require-user";
import type { UploadPermission } from "../../../../lib/storage/file-storage";
import {
  PHOTO_TARGET_GONE,
  type SendOutcome,
} from "../../../../lib/handover/offline/queued-changes";
import { completionMessage, type CompleteHandoverState } from "./handover-state";

const NOT_FOUND_MESSAGE = "This handover could not be found, or is already finished.";
const FAILED_MESSAGE = "Something went wrong and nothing was saved. Try again.";

async function actingUser() {
  const user = await requireUser();
  return { user, actor: { userId: user.id, operatorId: user.operatorId } };
}

/** Starts the rental's handover (or picks up the one under way) and opens it. */
export async function startHandoverAction(rentalId: string): Promise<void> {
  const { actor } = await actingUser();
  if (!isRecordId(rentalId)) {
    redirect(rentalPath(""));
  }
  await startHandover(appDb, actor, rentalId);
  redirect(rentalHandoverPath(rentalId));
}

export type SaveDetailsResult = { status: "saved" } | { status: "problem"; message: string };

/** Saves the checklist's details, as typed on the phone (a copy is kept there too). */
export async function saveHandoverDetailsAction(
  rentalId: string,
  inspectionId: string,
  values: Record<string, string>,
): Promise<SaveDetailsResult> {
  const { actor } = await actingUser();
  const parsed = handoverDetailsFormSchema.safeParse(values);
  if (!isRecordId(inspectionId) || !parsed.success) {
    return { status: "problem", message: "Some details are not right. Check them and try again." };
  }
  try {
    const result = await saveHandoverDetails(appDb, actor, inspectionId, parsed.data);
    revalidatePath(rentalHandoverPath(rentalId));
    if (result.status === "lower") {
      return {
        status: "problem",
        message: `The car last read ${formatKilometres(result.lastKilometres)}. Check the odometer: it cannot go down.`,
      };
    }
    return result.status === "saved" ? result : { status: "problem", message: NOT_FOUND_MESSAGE };
  } catch (error) {
    console.error("Saving a handover's details failed", describeErrorForLog(error));
    return { status: "problem", message: FAILED_MESSAGE };
  }
}

/** Saves a damage mark made on the phone; the queue sends it once there is signal. */
export async function addDamageMarkAction(
  inspectionId: string,
  mark: { x: number; y: number; description: string },
  markKey: string,
): Promise<{ markId: string } | { problem: string }> {
  const { actor } = await actingUser();
  const parsed = damageMarkInputSchema.safeParse(mark);
  if (!isRecordId(inspectionId) || !isRecordId(markKey) || !parsed.success) {
    return { problem: "That damage mark is not right: describe it, then try again." };
  }
  const result = await addDamageMark(appDb, actor, inspectionId, parsed.data, markKey);
  return result.status === "added" ? { markId: result.markId } : { problem: NOT_FOUND_MESSAGE };
}

export async function removeDamageMarkAction(
  rentalId: string,
  inspectionId: string,
  markId: string,
): Promise<string | null> {
  const { actor } = await actingUser();
  if (!isRecordId(inspectionId) || !isRecordId(markId)) {
    return NOT_FOUND_MESSAGE;
  }
  const result = await removeDamageMark(appDb, actor, inspectionId, markId);
  revalidatePath(rentalHandoverPath(rentalId));
  return result === "removed" ? null : NOT_FOUND_MESSAGE;
}

const targetSchema = z.union([
  z.object({ photoName: z.string().min(1) }),
  z.object({ damageMarkId: z.uuid() }),
]);
const photoRequestSchema = z.object({ photo: plannedFileSchema, thumbnail: plannedFileSchema });

interface AllowedUpload {
  fileId: string;
  permission: UploadPermission;
}

export type ChecklistPhotoStart =
  | { status: "allowed"; photo: AllowedUpload; thumbnail: AllowedUpload }
  /** Never allowed as it is: the wrong kind of file, empty or too large. */
  | { status: "refused"; message: string }
  /** Something went wrong this time: worth trying again. */
  | { status: "failed"; message: string }
  /** Its checklist or damage mark is gone (removed, or finished elsewhere): nothing to send it to. */
  | { status: "gone" };

/** Asks to send one checklist photo and its small copy, shrunk on the phone. */
export async function startChecklistPhotoAction(
  inspectionId: string,
  target: unknown,
  request: z.input<typeof photoRequestSchema>,
): Promise<ChecklistPhotoStart> {
  const { user, actor } = await actingUser();
  const parsedTarget = targetSchema.safeParse(target);
  const parsed = photoRequestSchema.safeParse(request);
  if (!isRecordId(inspectionId) || !parsedTarget.success || !parsed.success) {
    return { status: "refused", message: UPLOAD_PROBLEM_MESSAGES.type_not_allowed };
  }
  return orUploadFailed(
    "Starting a handover photo upload",
    async (): Promise<ChecklistPhotoStart> => {
      const result = await startChecklistPhotoUpload(
        fileDependencies(),
        actor,
        inspectionId,
        parsedTarget.data,
        parsed.data,
        user.operatorTimezone,
      );
      if (result.status === "not_found") {
        return { status: "gone" };
      }
      return result.status === "refused"
        ? { status: "refused", message: refusedMessage(result) }
        : { status: "allowed", photo: result.photo, thumbnail: result.thumbnail };
    },
    { status: "failed", message: UPLOAD_FAILED_MESSAGE },
  );
}

/** Null once the photo is saved; otherwise what to tell the person. */
export async function finishChecklistPhotoAction(
  photoId: string,
  thumbnailId: string,
): Promise<SendOutcome> {
  const { actor } = await actingUser();
  if (!isRecordId(photoId) || !isRecordId(thumbnailId)) {
    return { refusedForGood: UPLOAD_FAILED_MESSAGE };
  }
  return orUploadFailed(
    "Finishing a handover photo upload",
    async (): Promise<SendOutcome> => {
      const deps = fileDependencies();
      const result = await confirmUpload(deps, actor, photoId, ["vehicle_photo"]);
      if (result === "wrong_type") {
        return { refusedForGood: finishMessage(result, "vehicle_photo") ?? UPLOAD_FAILED_MESSAGE };
      }
      if (result === "not_found") {
        return PHOTO_TARGET_GONE;
      }
      // The small copy only once its photo is kept, so none is left with nothing to show (review A7-5).
      if (result === "confirmed") {
        await confirmUpload(deps, actor, thumbnailId, ["vehicle_photo_thumbnail"]);
      }
      return finishMessage(result, "vehicle_photo");
    },
    UPLOAD_FAILED_MESSAGE,
  );
}

const completeSchema = z.object(
  Object.fromEntries(
    Object.values(OVERRIDE_REASON_FIELDS).map((field) => [field, optionalLine]),
  ) as Record<OverrideReasonField, typeof optionalLine>,
);

/** The Renter accepts the car on this phone: the handover is finished and the report issued. */
export async function completeHandoverAction(
  rentalId: string,
  inspectionId: string,
  _previous: CompleteHandoverState,
  formData: FormData,
): Promise<CompleteHandoverState> {
  const { user, actor } = await actingUser();
  const parsed = completeSchema.safeParse(
    Object.fromEntries(
      Object.values(OVERRIDE_REASON_FIELDS).map((field) => [field, formData.get(field) ?? ""]),
    ),
  );
  if (!isRecordId(rentalId) || !isRecordId(inspectionId) || !parsed.success) {
    return { status: "problem", message: NOT_FOUND_MESSAGE };
  }
  try {
    const result = await completeHandover(
      { ...fileDependencies(), emailSender: appEmailSender, canHearRenterPayments },
      actor,
      inspectionId,
      {
        ...parsed.data,
        shownFingerprint: String(formData.get("checklistFingerprint") ?? ""),
        signature: renterSignatureFrom(formData),
      },
      { timeZone: user.operatorTimezone, now: new Date() },
    );
    revalidatePath(rentalPath(rentalId));
    revalidatePath(rentalHandoverPath(rentalId));
    return result.status === "completed"
      ? { status: "completed" }
      : { status: "problem", message: completionMessage(result) };
  } catch (error) {
    console.error("Completing a handover failed", describeErrorForLog(error));
    return { status: "problem", message: FAILED_MESSAGE };
  }
}

export async function cancelHandoverAction(rentalId: string, inspectionId: string): Promise<void> {
  const { actor } = await actingUser();
  if (isRecordId(inspectionId)) {
    await cancelHandover(appDb, actor, inspectionId);
  }
  redirect(rentalPath(rentalId));
}
