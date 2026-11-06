import { Badge } from "@fleetapp/ui/badge";

import { RENTAL_STATUS_BADGES } from "../../lib/rentals/rental-list-status";
import type { RentalSummary } from "../../lib/rentals/rental-queries";

/** What is wrong with a rental out on rent: overdue, or at risk because the car is not back. */
export function RentalAlertBadges({
  rental,
}: {
  rental: Pick<RentalSummary, "isOverdue" | "isAtRisk">;
}) {
  return (
    <>
      {rental.isOverdue ? <Badge tone="danger">Overdue</Badge> : null}
      {rental.isAtRisk ? <Badge tone="danger">At risk: car not back</Badge> : null}
    </>
  );
}

/**
 * The rental's step in plain words (Out, To close), then anything that needs
 * a look: overdue, at risk, starting soon.
 */
export function RentalBadges({
  rental,
}: {
  rental: Pick<RentalSummary, "status" | "isOverdue" | "isAtRisk" | "isStartingSoon">;
}) {
  const badge = RENTAL_STATUS_BADGES[rental.status];
  return (
    <span className="flex flex-wrap gap-1">
      <Badge tone={badge.tone}>{badge.text}</Badge>
      <RentalAlertBadges rental={rental} />
      {rental.isStartingSoon && !rental.isAtRisk ? (
        <Badge tone="attention">Starting soon</Badge>
      ) : null}
    </span>
  );
}
