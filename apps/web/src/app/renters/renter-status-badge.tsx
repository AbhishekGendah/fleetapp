import { RENTER_STATUS_LABELS, type RenterStatus } from "@fleetapp/core";
import { Badge, type BadgeTone } from "@fleetapp/ui/badge";

const STATUS_TONES: Readonly<Record<RenterStatus, BadgeTone>> = {
  active: "good",
  do_not_rent: "danger",
};

export function RenterStatusBadge({
  status,
  isArchived = false,
}: {
  status: RenterStatus;
  isArchived?: boolean;
}) {
  if (isArchived) {
    return <Badge>Archived</Badge>;
  }
  return <Badge tone={STATUS_TONES[status]}>{RENTER_STATUS_LABELS[status]}</Badge>;
}
