import { formatCalendarDate } from "@fleetapp/core";
import { failedState, savedState, type ChangeFormState } from "@fleetapp/ui/change-form-state";

import { policyPath } from "../paths";
import type { AddVehicleResult } from "./insurance";
import type { CoverOverlap } from "./insurance-overlaps";

export const SAME_POLICY_MESSAGE =
  "A policy with this number already covers these dates. Add the car to that one instead.";

/** The link offered with that refusal. */
export function samePolicyLink(policyId: string): { href: string; label: string } {
  return { href: policyPath(policyId), label: "Open that policy" };
}

/**
 * "Saved. Already insured for some of these dates: 1ABC234 by Example
 * Insurance to 1 Oct 2027." Null when nothing overlaps.
 */
export function coverOverlapWarning(overlaps: readonly CoverOverlap[]): string | null {
  if (overlaps.length === 0) {
    return null;
  }
  const covered = overlaps
    .map(
      (overlap) => `${overlap.rego} by ${overlap.insurer} to ${formatCalendarDate(overlap.endsOn)}`,
    )
    .join("; ");
  return `Saved. Already insured for some of these dates: ${covered}.`;
}

/** The answer to putting a car on a policy, from the car's page or the policy's. */
export function addedCarState(
  result: AddVehicleResult,
  messages: { notFound: string; added: string },
): ChangeFormState {
  if (result.status === "not_found") {
    return failedState(messages.notFound);
  }
  if (result.status === "already_on") {
    return savedState("It is already on that policy.");
  }
  const warning = coverOverlapWarning(result.overlaps);
  return warning ? savedState(warning, true) : savedState(messages.added);
}
