import { RENTAL_STATUS_LABELS, type RentalStatus } from "@fleetapp/core";
import { Badge, type BadgeTone } from "@fleetapp/ui/badge";

import type { RentalSummary } from "../../lib/rentals/rental-queries";

const STATUS_TONES: Readonly<Record<RentalStatus, BadgeTone>> = {
  draft: "neutral",
  booked: "good",
  active: "good",
  returned: "neutral",
  closed: "neutral",
  cancelled: "neutral",
};

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

/** The rental's step, then anything that needs a look: overdue, at risk, starting soon. */
export function RentalBadges({
  rental,
}: {
  rental: Pick<RentalSummary, "status" | "isOverdue" | "isAtRisk" | "isStartingSoon">;
}) {
  return (
    <span className="flex flex-wrap gap-1">
      <Badge tone={STATUS_TONES[rental.status]}>{RENTAL_STATUS_LABELS[rental.status]}</Badge>
      <RentalAlertBadges rental={rental} />
      {rental.isStartingSoon && !rental.isAtRisk ? (
        <Badge tone="attention">Starting soon</Badge>
      ) : null}
    </span>
  );
}
