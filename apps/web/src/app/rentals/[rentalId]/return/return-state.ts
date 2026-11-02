import { formatKilometres, RETURN_TIME_MESSAGES } from "@fleetapp/core";

import type { CompleteReturnResult } from "../../../../lib/handover/complete-return";
import { gapsMessage } from "../handover/handover-state";

/** What finishing the return came back with, for its form. */
export type CompleteReturnState =
  { status: "idle" } | { status: "completed" } | { status: "problem"; message: string };

export const INITIAL_RETURN_STATE: CompleteReturnState = { status: "idle" };

/** Why the return cannot be finished yet, in plain words. */
export function returnRefusalMessage(
  result: Exclude<CompleteReturnResult, { status: "completed" }>,
): string {
  switch (result.status) {
    case "gaps":
      return gapsMessage(result.gaps);
    case "lower":
      return `The car last read ${formatKilometres(result.lastKilometres)}. Check the kilometres: they cannot go down.`;
    case "return_time":
      return RETURN_TIME_MESSAGES[result.problem];
    case "signature_required":
      return "Your settings need the Renter's signature at the return. Ask them to sign in the box.";
    case "no_signature":
      return "Ask the Renter to sign in the box.";
    case "car_status":
      return "Choose Available, In service or Off road for the car.";
    case "finished_already":
      return "This return is already finished.";
    case "not_found":
      return "This return could not be found.";
  }
}
