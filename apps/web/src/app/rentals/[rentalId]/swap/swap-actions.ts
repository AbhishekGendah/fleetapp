"use server";

import { describeErrorForLog, formTextValues, isRecordId } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { appDb } from "../../../../lib/app-db";
import { appEmailSender } from "../../../../lib/email-sender";
import { fileDependencies } from "../../../../lib/files/file-action-support";
import { completeSwap, type ShownSwap } from "../../../../lib/handover/complete-swap";
import { renterSignatureFrom } from "../../../../lib/handover/renter-signature-form";
import { rentalPath, rentalSwapPath } from "../../../../lib/paths";
import { cancelSwap, startSwap } from "../../../../lib/rentals/car-swaps";
import {
  FINISH_SWAP_FIELDS,
  finishSwapFormSchema,
  START_SWAP_FIELDS,
  startSwapFormSchema,
} from "../../../../lib/rentals/swap-input";
import { requireUser } from "../../../../lib/require-user";
import { runUserChange } from "../../../../lib/run-change";
import {
  cancelSwapRefusalMessage,
  startSwapRefusalMessage,
  swapRefusalMessage,
  type CompleteSwapState,
} from "./swap-state";

const INVALID_MESSAGE = "Some details are not right. Check them and try again.";
const FAILED_MESSAGE = "Something went wrong and nothing was saved. Try again.";

/** Starts the swap (or picks up the one under way) and opens the old car's checklist. */
export async function startSwapAction(
  rentalId: string,
  _previous: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const parsed = startSwapFormSchema.safeParse(formTextValues(formData, START_SWAP_FIELDS));
  if (!isRecordId(rentalId) || !parsed.success) {
    return failedState(INVALID_MESSAGE);
  }
  const state = await runUserChange({
    description: "Starting a car swap",
    pagesToRefresh: [rentalPath(rentalId)],
    change: async (actor, user) => {
      const result = await startSwap(appDb, actor, rentalId, parsed.data, {
        timeZone: user.operatorTimezone,
        now: new Date(),
      });
      if ("swapId" in result) {
        return savedState("Swap started.");
      }
      return failedState(startSwapRefusalMessage(result));
    },
  });
  if (state.status === "saved") {
    redirect(rentalSwapPath(rentalId, "old"));
  }
  return state;
}

/** Stops the swap under way: the Renter keeps the car they have. */
export async function cancelSwapAction(
  rentalId: string,
  _previous: ChangeFormState,
): Promise<ChangeFormState> {
  if (!isRecordId(rentalId)) {
    return failedState(cancelSwapRefusalMessage("not_found"));
  }
  const state = await runUserChange({
    description: "Cancelling a car swap",
    pagesToRefresh: [],
    change: async (actor) => {
      const result = await cancelSwap(appDb, actor, rentalId);
      return result === "cancelled"
        ? savedState("Swap cancelled.")
        : failedState(cancelSwapRefusalMessage(result));
    },
  });
  if (state.status === "saved") {
    redirect(rentalPath(rentalId));
  }
  return state;
}

/** What the signing step showed, as it sent it back: checked against the swap as it stands. */
function shownSwapFrom(formData: FormData): ShownSwap {
  const text = (name: keyof ShownSwap): string => String(formData.get(name) ?? "");
  return {
    swapId: text("swapId"),
    returnFingerprint: text("returnFingerprint"),
    handoverFingerprint: text("handoverFingerprint"),
    swapTemplateVersionId: text("swapTemplateVersionId"),
    swapFormFingerprint: text("swapFormFingerprint"),
  };
}

/** The Renter signs the swap on this phone: both cars and the rental move, three documents are issued. */
export async function completeSwapAction(
  rentalId: string,
  _previous: CompleteSwapState,
  formData: FormData,
): Promise<CompleteSwapState> {
  const user = await requireUser();
  const parsed = finishSwapFormSchema.safeParse(formTextValues(formData, FINISH_SWAP_FIELDS));
  if (!isRecordId(rentalId) || !parsed.success) {
    return { status: "problem", message: INVALID_MESSAGE };
  }
  try {
    const result = await completeSwap(
      { ...fileDependencies(), emailSender: appEmailSender },
      { userId: user.id, operatorId: user.operatorId },
      rentalId,
      {
        shown: shownSwapFrom(formData),
        signature: renterSignatureFrom(formData),
        oldCarAfter: parsed.data,
      },
      { timeZone: user.operatorTimezone, now: new Date() },
    );
    revalidatePath(rentalPath(rentalId));
    return result.status === "completed"
      ? { status: "completed" }
      : { status: "problem", message: swapRefusalMessage(result) };
  } catch (error) {
    console.error("Completing a car swap failed", describeErrorForLog(error));
    return { status: "problem", message: FAILED_MESSAGE };
  }
}
