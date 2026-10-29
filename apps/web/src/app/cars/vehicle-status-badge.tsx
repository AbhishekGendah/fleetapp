import { VEHICLE_STATUS_LABELS, type VehicleStatus } from "@fleetapp/core";
import { Badge, type BadgeTone } from "@fleetapp/ui/badge";

/** Ready to rent, off the road for now, or gone from the fleet. */
const STATUS_TONES: Readonly<Record<VehicleStatus, BadgeTone>> = {
  available: "good",
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
