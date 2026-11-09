import { formatKilometres } from "@fleetapp/core";

import type { CompleteDriverChangeResult } from "../../../../lib/handover/complete-driver-change";
import type {
  CancelDriverChangeResult,
  StartDriverChangeResult,
} from "../../../../lib/rentals/driver-changes";
import {
  bookingProblemMessage,
  MISSING_DRIVER_MESSAGES,
} from "../../../../lib/rentals/rental-messages";
import {
  CHECKLIST_CHANGED_MESSAGE,
  gapsMessage,
  PHOTO_MISSING_MESSAGE,
} from "../handover/handover-state";

/** What finishing the driver change came back with, for its form. */
export type CompleteDriverChangeState =
  { status: "idle" } | { status: "completed" } | { status: "problem"; message: string };

export const INITIAL_DRIVER_CHANGE_STATE: CompleteDriverChangeState = { status: "idle" };

const NOT_FOUND = "There is no driver change under way for this rental.";

/** What stops the new driver taking the car, in words: the first that counts. */
function problemsMessage(result: Extract<CompleteDriverChangeResult, { status: "refused" }>) {
  const blocking = result.problems.find((problem) => problem.level !== "notice");
  return blocking
    ? `${bookingProblemMessage(blocking, true)} So the car stays with the driver who has it.`
    : "The new driver can't take the car yet.";
}

/** Why the driver change cannot be signed yet, in plain words. */
export function driverChangeRefusalMessage(
  result: Exclude<CompleteDriverChangeResult, { status: "completed" }>,
): string {
  switch (result.status) {
    case "gaps":
      return `For the check-in: ${gapsMessage(result.gaps)}`;
    case "lower":
      return `The car last read ${formatKilometres(result.lastKilometres)}. Check its kilometres: they cannot go down.`;
    case "refused":
      return problemsMessage(result);
    case "no_signature":
      return "Ask the new driver to sign in their box, or type their full name exactly as shown.";
    case "no_outgoing_signature":
      return "Ask the driver handing the car back to sign in their box, or type their full name exactly as shown.";
    case "signature_required":
      return "Your rules for this rental ask the driver handing the car back to sign.";
    case "photo_missing":
      return PHOTO_MISSING_MESSAGE;
    case "changed":
      return CHECKLIST_CHANGED_MESSAGE;
    case "finished_already":
      return "This driver change was already finished or cancelled. Reload the page to see where it stands.";
    case "renter_not_found":
    case "car_not_found":
    case "not_found":
      return NOT_FOUND;
    default:
      return MISSING_DRIVER_MESSAGES[result.status];
  }
}

/** Why a driver change could not start, in plain words. */
export function startDriverChangeRefusalMessage(
  result: Exclude<StartDriverChangeResult, { status: "started" | "resumed" }>,
): string {
  switch (result.status) {
    case "refused":
      return problemsMessage(result);
    case "same_driver":
      return "That is the driver who has the car now. Choose another driver.";
    case "swap_under_way":
      return "A car swap is under way. Finish or cancel it first.";
    case "checklist_under_way":
      return "A return is under way. Finish or cancel it first.";
    case "not_out":
      return "Only a business's car that is out changes its driver here.";
    case "renter_not_found":
    case "car_not_found":
    case "not_found":
      return "That rental could not be found.";
    default:
      return MISSING_DRIVER_MESSAGES[result.status];
  }
}

/** Why the driver change could not be cancelled; the page stays as it was. */
export function cancelDriverChangeRefusalMessage(
  result: Exclude<CancelDriverChangeResult, "cancelled">,
): string {
  return result === "finished_already"
    ? "This driver change was already finished or cancelled, so nothing was changed. Reload the page to see where it stands."
    : "This rental could not be found.";
}
