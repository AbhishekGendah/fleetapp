import { formatKilometres, mergeFieldLabel } from "@fleetapp/core";

import type { CompleteSwapResult } from "../../../../lib/handover/complete-swap";
import type { CancelSwapResult, StartSwapResult } from "../../../../lib/rentals/car-swaps";
import {
  gapsMessage,
  CHECKLIST_CHANGED_MESSAGE,
  PHOTO_MISSING_MESSAGE,
  SIGNATURE_NEEDED,
} from "../handover/handover-state";

/** What finishing the swap came back with, for its form. */
export type CompleteSwapState =
  { status: "idle" } | { status: "completed" } | { status: "problem"; message: string };

export const INITIAL_SWAP_STATE: CompleteSwapState = { status: "idle" };

const CAR_WORDS = { old: "the car handed back", new: "the new car" } as const;
const SWAP_FORM_SETUP = "Set up your car swap form first, in Settings → Contracts.";
/** Why a swap or a return waits: the driver change has its own check-in of this car. */
export const DRIVER_CHANGE_FIRST = "A driver change is under way. Finish or cancel it first.";

/** Why the swap cannot be finished yet, in plain words. */
export function swapRefusalMessage(
  result: Exclude<CompleteSwapResult, { status: "completed" }>,
): string {
  switch (result.status) {
    case "gaps":
      return `For ${CAR_WORDS[result.car]}: ${gapsMessage(result.gaps)}`;
    case "lower":
      return `${CAR_WORDS[result.car]} last read ${formatKilometres(result.lastKilometres)}. Check its kilometres: they cannot go down.`;
    case "missing":
      return `Fill in what the swap form needs first: ${result.fields.map(mergeFieldLabel).join(", ")}.`;
    case "no_template":
      return SWAP_FORM_SETUP;
    case "photo_missing":
      return PHOTO_MISSING_MESSAGE;
    case "changed":
      return CHECKLIST_CHANGED_MESSAGE;
    case "form_changed":
      return "Your car swap form changed since this page opened, so nothing was signed. Reload the page, then the Renter reads it again.";
    case "no_signature":
      return SIGNATURE_NEEDED;
    case "car_status":
      return "Choose Available, In service or Off road for the car handed back.";
    case "clash":
      return "Another booking took the new car meanwhile. Cancel this swap and choose another car.";
    case "new_car_changed":
      return "The new car was sold, sent to the workshop or archived since the swap began, so nothing was signed. Cancel this swap and choose another car.";
    case "finished_already":
      return "This swap is already finished.";
    case "not_found":
      return "There is no swap under way for this rental.";
  }
}

/** Why a swap could not start, in plain words. */
export function startSwapRefusalMessage(
  result: Exclude<StartSwapResult, { status: "started" | "resumed" }>,
): string {
  switch (result.status) {
    case "clash":
      return "That car is booked for part of the rest of this rental. Choose another car.";
    case "same_car":
      return "That is the car the Renter has now.";
    case "car_not_available":
      return "That car is not Available. Choose an available car.";
    case "return_under_way":
      return "A return is under way. Finish or cancel it first.";
    case "driver_change_under_way":
      return DRIVER_CHANGE_FIRST;
    case "not_out":
      return "Only a rental whose car is out can swap it.";
    case "no_template":
      return SWAP_FORM_SETUP;
    case "not_found":
      return "That rental could not be found.";
  }
}

/**
 * Why the swap could not be cancelled. The page is left as it was, so the
 * words stay; reloading shows the swap as it now stands.
 */
export function cancelSwapRefusalMessage(result: Exclude<CancelSwapResult, "cancelled">): string {
  switch (result) {
    case "finished_already":
      return "This swap was already finished or cancelled, so nothing was changed. Reload the page to see where it stands.";
    case "not_found":
      return "This rental could not be found.";
  }
}
