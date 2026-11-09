import type { RenterKind } from "./renters";
import type { RentalStatus } from "./rentals";

/**
 * Changing a business's driver while its car is out (docs/plans/
 * business-renters.md, decision 4 and slice 4): the car is brought in and
 * checked in from the driver who has it, then the new driver signs for it.
 * One driver's time with the car ends and the next one's starts at that
 * same moment (rule 15), so a fine always names who had the car.
 */

export const DRIVER_CHANGE_STATUSES = ["in_progress", "completed", "cancelled"] as const;
export type DriverChangeStatus = (typeof DRIVER_CHANGE_STATUSES)[number];

/** The phone flow's three steps (mockup 7), in order, named by who is in each. */
export function driverChangeStepNames(fromFirstName: string, toFirstName: string): string[] {
  return ["Why and who", `Check in from ${fromFirstName}`, `${toFirstName} signs`];
}

/** Only a business's rental whose car is out changes its driver this way; before then it is named. */
export function canChangeDriver(status: RentalStatus, renterKind: RenterKind): boolean {
  return status === "active" && renterKind === "organisation";
}
