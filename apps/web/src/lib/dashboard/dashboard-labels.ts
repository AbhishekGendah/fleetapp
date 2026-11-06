import { formatCents, VEHICLE_STATUS_LABELS } from "@fleetapp/core";

import type { HandoverBlocker } from "./rentals-this-week";

/** What a booking is still waiting on before handover, in a few words for a badge. */
export function handoverBlockerLabel(blocker: HandoverBlocker): string {
  switch (blocker.code) {
    case "contract_unsigned":
      return "Contract not signed";
    case "bond_short":
      return `Bond owing ${formatCents(blocker.owingCents)}`;
    case "details_missing":
      return "Renter details missing";
    case "car_not_ready":
      return `Car ${VEHICLE_STATUS_LABELS[blocker.carStatus].toLowerCase()}`;
    case "licence_expired_by_start":
      return "Licence expired";
    case "under_minimum_age":
      return "Renter under minimum age";
    case "provisional_licence":
      return "Provisional licence";
    default:
      return "Check the rental";
  }
}
