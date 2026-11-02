import { formatCents, formatKilometres, type HandoverGap } from "@fleetapp/core";

import type { CompleteHandoverResult } from "../../../../lib/handover/complete-handover";
import { bookingProblemMessage } from "../../../../lib/rentals/rental-messages";

/** Said whenever the Renter is to sign on the phone and has not. */
export const SIGNATURE_NEEDED = "Ask the Renter to sign in the box.";

/** What finishing the handover came back with, for its form. */
export type CompleteHandoverState =
  { status: "idle" } | { status: "completed" } | { status: "problem"; message: string };

export const INITIAL_COMPLETE_STATE: CompleteHandoverState = { status: "idle" };

const GAP_LABELS: Readonly<Record<Exclude<HandoverGap["kind"], "photo">, string>> = {
  odometer: "the kilometres",
  fuel: "the fuel level",
  keys: "how many keys",
  damage_photo: "a photo of each damage mark",
};

/** What is still missing, in a few words: "Still needed: Front photo, the fuel level." */
export function gapsMessage(gaps: readonly HandoverGap[]): string {
  const parts = gaps.map((gap) =>
    gap.kind === "photo" ? `${gap.name} photo` : GAP_LABELS[gap.kind],
  );
  return `Still needed: ${parts.join(", ")}.`;
}

/** Why the Renter cannot accept the car yet, in plain words. */
export function completionMessage(
  result: Exclude<CompleteHandoverResult, { status: "completed" }>,
): string {
  switch (result.status) {
    case "gaps":
      return gapsMessage(result.gaps);
    case "blocked":
      return result.problems.map(bookingProblemMessage).join(" ");
    case "bond_short":
      return `The bond is ${formatCents(result.owingCents)} short. Record it on the rental, or say why the car goes before it is paid.`;
    case "lower":
      return `The car last read ${formatKilometres(result.lastKilometres)}. Check the kilometres: they cannot go down.`;
    case "contract_unsigned":
      return "The Renter has not signed the contract yet. Send it for signing from the rental's page.";
    case "no_signature":
      return SIGNATURE_NEEDED;
    case "finished_already":
      return "This handover is already finished.";
    case "not_found":
      return "This handover could not be found.";
  }
}
