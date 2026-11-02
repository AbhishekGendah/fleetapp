import type { RentalStatus } from "./rentals";

/**
 * Car swaps (docs/plans/phase-3-slice-7.md, 7b): the Renter swaps into
 * another car during the same rental. The old car is checked in as a
 * return, the new one out as a handover, and the Renter signs the swap form
 * on the Operator's phone.
 */

export const CAR_SWAP_STATUSES = ["in_progress", "completed", "cancelled"] as const;
export type CarSwapStatus = (typeof CAR_SWAP_STATUSES)[number];

/** Where the old car may go after a swap: sold or written off are set on the car's own page. */
export const STATUSES_AFTER_SWAP = ["available", "in_service", "off_road"] as const;

/** Only a rental whose car is out can swap it. */
export function canSwapCar(status: RentalStatus): boolean {
  return status === "active";
}
