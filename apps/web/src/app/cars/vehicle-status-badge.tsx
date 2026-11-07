import { VEHICLE_STATUS_LABELS, type VehicleStatus } from "@fleetapp/core";
import { Badge, type BadgeTone } from "@fleetapp/ui/badge";

/**
 * Out with a Renter (as on Home and Rentals), free to rent (outlined), in the
 * workshop, or gone from the fleet: each lighter or darker than the next, not
 * only another colour (7 Nov 2026 look).
 */
const STATUS_TONES: Readonly<Record<VehicleStatus, BadgeTone>> = {
  available: "available",
  rented: "out",
  in_service: "attention",
  off_road: "attention",
  sold: "neutral",
  written_off: "neutral",
};

export function VehicleStatusBadge({
  status,
  isArchived = false,
}: {
  status: VehicleStatus;
  isArchived?: boolean;
}) {
  if (isArchived) {
    return <Badge>Archived</Badge>;
  }
  return <Badge tone={STATUS_TONES[status]}>{VEHICLE_STATUS_LABELS[status]}</Badge>;
}
