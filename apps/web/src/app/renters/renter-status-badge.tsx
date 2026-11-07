import { Badge } from "@fleetapp/ui/badge";

/** Was "Waiting for review" (Abhi, 7 Nov 2026): blue, as on Home's Needs attention. */
export const WAITING_REVIEW_LABEL = "To review";

/** The Renter sent details through their link that the Operator has not reviewed yet. */
export function WaitingReviewBadge() {
  return <Badge tone="booked">{WAITING_REVIEW_LABEL}</Badge>;
}
