"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { describeErrorForLog, formTextValues, isRecordId } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";

import { appDb } from "../../../../lib/app-db";
import { appEmailSender } from "../../../../lib/email-sender";
import { fileDependencies } from "../../../../lib/files/file-action-support";
import { completeDriverChange } from "../../../../lib/handover/complete-driver-change";
import { parseCompleteDriverChange } from "../../../../lib/handover/signing-step-forms";
import { rentalDriverChangePath, rentalPath } from "../../../../lib/paths";
import {
  START_DRIVER_CHANGE_FIELDS,
  startDriverChangeFormSchema,
} from "../../../../lib/rentals/driver-change-input";
import { cancelDriverChange, startDriverChange } from "../../../../lib/rentals/driver-changes";
import { requireUser } from "../../../../lib/require-user";
import { runUserChange } from "../../../../lib/run-change";
import {
  cancelDriverChangeRefusalMessage,
  driverChangeRefusalMessage,
  startDriverChangeRefusalMessage,
  type CompleteDriverChangeState,
} from "./driver-change-state";

const INVALID_MESSAGE = "Some details are not right. Check them and try again.";
const FAILED_MESSAGE = "Something went wrong and nothing was saved. Try again.";

/** Starts the driver change (or picks up the one under way) and opens its check-in. */
export async function startDriverChangeAction(
  rentalId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = startDriverChangeFormSchema.safeParse(
    formTextValues(formData, START_DRIVER_CHANGE_FIELDS),
  );
  if (!isRecordId(rentalId) || !parsed.success) {
    return failedState(INVALID_MESSAGE);
  }
  const state = await runUserChange({
    description: "Starting a driver change",
    pagesToRefresh: [rentalPath(rentalId)],
    change: async (actor, user) => {
      const result = await startDriverChange(appDb, actor, rentalId, parsed.data, {
        timeZone: user.operatorTimezone,
        now: new Date(),
      });
      return "changeId" in result
        ? savedState("Driver change started.")
        : failedState(startDriverChangeRefusalMessage(result));
    },
  });
  if (state.status === "saved") {
    redirect(rentalDriverChangePath(rentalId, "check-in"));
  }
  return state;
}

/** Stops the driver change under way: the driver who has the car keeps it. */
export async function cancelDriverChangeAction(
  rentalId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (!isRecordId(rentalId)) {
    return failedState(cancelDriverChangeRefusalMessage("not_found"));
  }
  const state = await runUserChange({
    description: "Cancelling a driver change",
    pagesToRefresh: [],
    change: async (actor) => {
      const result = await cancelDriverChange(appDb, actor, rentalId);
      return result === "cancelled"
        ? savedState("Driver change cancelled.")
        : failedState(cancelDriverChangeRefusalMessage(result));
    },
  });
  if (state.status === "saved") {
    redirect(rentalPath(rentalId));
  }
  return state;
}

/** Both drivers sign on this phone: possession moves to the new driver, two reports are issued. */
export async function completeDriverChangeAction(
  rentalId: string,
  _previous: CompleteDriverChangeState,
  formData: FormData,
): Promise<CompleteDriverChangeState> {
  const user = await requireUser();
  const input = parseCompleteDriverChange(formData);
  if (!isRecordId(rentalId) || !input) {
    return { status: "problem", message: INVALID_MESSAGE };
  }
  try {
    const result = await completeDriverChange(
      { ...fileDependencies(), emailSender: appEmailSender },
      { userId: user.id, operatorId: user.operatorId },
      rentalId,
      input,
      { timeZone: user.operatorTimezone, now: new Date() },
    );
    revalidatePath(rentalPath(rentalId));
    return result.status === "completed"
      ? { status: "completed" }
      : { status: "problem", message: driverChangeRefusalMessage(result) };
  } catch (error) {
    console.error("Completing a driver change failed", describeErrorForLog(error));
    return { status: "problem", message: FAILED_MESSAGE };
  }
}
