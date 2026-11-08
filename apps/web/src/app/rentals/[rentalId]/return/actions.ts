"use server";

import { describeErrorForLog, isRecordId } from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { appDb } from "../../../../lib/app-db";
import { appEmailSender } from "../../../../lib/email-sender";
import { fileDependencies } from "../../../../lib/files/file-action-support";
import { renterSignatureFrom } from "../../../../lib/handover/renter-signature-form";
import { completeReturn } from "../../../../lib/handover/complete-return";
import { cancelHandover, startReturn } from "../../../../lib/handover/handover-records";
import { RETURN_FORM_FIELDS, returnFormSchema } from "../../../../lib/handover/return-input";
import { rentalPath, rentalReturnPath } from "../../../../lib/paths";
import { requireUser } from "../../../../lib/require-user";
import { returnRefusalMessage, type CompleteReturnState } from "./return-state";

const FIX_MESSAGE = "Some boxes need a look: see below.";
const FAILED_MESSAGE = "Something went wrong and nothing was saved. Try again.";

/** Starts the rental's return (or picks up the one under way) and opens it. */
export async function startReturnAction(
  rentalId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  const user = await requireUser();
  if (isRecordId(rentalId)) {
    await startReturn(appDb, { userId: user.id, operatorId: user.operatorId }, rentalId);
  }
  redirect(rentalReturnPath(rentalId));
}

export async function cancelReturnAction(rentalId: string, inspectionId: string): Promise<void> {
  const user = await requireUser();
  if (isRecordId(inspectionId)) {
    await cancelHandover(appDb, { userId: user.id, operatorId: user.operatorId }, inspectionId);
  }
  redirect(rentalPath(rentalId));
}

/**
 * Finishes the return: possession ends at the time given, the car is freed
 * and set as chosen, and the report is issued and emailed. Checked with the
 * same rules as the form (rule 28), on the business's clock (rule 10).
 */
export async function completeReturnAction(
  rentalId: string,
  inspectionId: string,
  _previous: CompleteReturnState,
  formData: FormData,
): Promise<CompleteReturnState> {
  const user = await requireUser();
  const values = Object.fromEntries(
    RETURN_FORM_FIELDS.map((field) => [field, String(formData.get(field) ?? "")]),
  );
  const parsed = returnFormSchema(user.operatorTimezone).safeParse(values);
  if (!isRecordId(rentalId) || !isRecordId(inspectionId)) {
    return { status: "problem", message: returnRefusalMessage({ status: "not_found" }) };
  }
  if (!parsed.success) {
    return { status: "problem", message: FIX_MESSAGE };
  }
  const signature = renterSignatureFrom(formData);
  try {
    const result = await completeReturn(
      { ...fileDependencies(), emailSender: appEmailSender },
      { userId: user.id, operatorId: user.operatorId },
      inspectionId,
      {
        shownFingerprint: String(formData.get("checklistFingerprint") ?? ""),
        returnedAt: parsed.data.returnedAt,
        signature: parsed.data.isRenterPresent ? signature : null,
        carAfter: parsed.data.carAfter,
      },
      { timeZone: user.operatorTimezone, now: new Date() },
    );
    revalidatePath(rentalPath(rentalId));
    return result.status === "completed"
      ? { status: "completed" }
      : { status: "problem", message: returnRefusalMessage(result) };
  } catch (error) {
    console.error("Completing a return failed", describeErrorForLog(error));
    return { status: "problem", message: FAILED_MESSAGE };
  }
}
