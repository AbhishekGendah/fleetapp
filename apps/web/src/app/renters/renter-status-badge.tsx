import { RENTER_STATUS_LABELS, type RenterStatus } from "@fleetapp/core";
import { Badge, type BadgeTone } from "@fleetapp/ui/badge";

/** Do not rent is solid dark red: the darkest label, not only another colour (7 Nov 2026 look). */
const STATUS_TONES: Readonly<Record<RenterStatus, BadgeTone>> = {
  active: "good",
  do_not_rent: "refused",
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

/** Was "Waiting for review" (Abhi, 7 Nov 2026): blue, as on Home's Needs attention. */
export const WAITING_REVIEW_LABEL = "To review";

/** The Renter sent details through their link that the Operator has not reviewed yet. */
export function WaitingReviewBadge() {
  return <Badge tone="booked">{WAITING_REVIEW_LABEL}</Badge>;
}
