import {
  formatCents,
  formatDateTimeInTimeZone,
  RENTAL_STATUS_LABELS,
  RENTAL_STATUSES,
  renterDisplayName,
} from "@fleetapp/core";
import type { DataListDefinition } from "@fleetapp/ui/data-list";

import { STATUS_FILTER_KEY, type RentalSummary } from "../../lib/rentals/rental-queries";
import { RentalBadges } from "./rental-status-badge";

const ONGOING = "Ongoing";

/** The rentals list on the Operator's clock (rule 10). */
export function rentalList(timeZone: string): DataListDefinition<RentalSummary> {
  const onClock = (moment: Date) => formatDateTimeInTimeZone(moment, timeZone);
  return {
    columns: [
      {
        key: "renter",
        label: "Renter",
        isCardTitle: true,
        isSortable: true,
        exportValue: (rental) =>
          renterDisplayName(rental.renterFullName, rental.renterPreferredName),
      },
      {
        key: "rego",
        label: "Car",
        isSortable: true,
        exportValue: (rental) => `${rental.rego} ${rental.make} ${rental.model}`,
        render: (rental) => (
          <span>
            <span className="font-medium">{rental.rego}</span>{" "}
            <span className="text-muted-foreground">
              {rental.make} {rental.model}
            </span>
          </span>
        ),
      },
      {
        key: "start",
        label: "Starts",
        isSortable: true,
        exportValue: (rental) => onClock(rental.plannedStart),
      },
      {
        key: "end",
        label: "Ends",
        isSortable: true,
        exportValue: (rental) => (rental.plannedEnd ? onClock(rental.plannedEnd) : ONGOING),
      },
      {
        key: "weeklyRate",
        label: "Weekly rate",
        exportValue: (rental) => formatCents(rental.weeklyRateCents),
      },
      {
        key: "status",
        label: "Status",
        isSortable: true,
        exportValue: (rental) => RENTAL_STATUS_LABELS[rental.status],
        render: (rental) => <RentalBadges rental={rental} />,
      },
    ],
    filters: [
      {
        key: STATUS_FILTER_KEY,
        label: "Status",
        options: RENTAL_STATUSES.map((status) => ({
          value: status,
          label: RENTAL_STATUS_LABELS[status],
        })),
      },
    ],
    defaultSort: { column: "start", direction: "desc" },
  };
}
