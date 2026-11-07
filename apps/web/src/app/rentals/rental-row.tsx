import { cn } from "@fleetapp/ui/cn";
import { ROW_CLASSES, RowLink } from "@fleetapp/ui/row-link";
import Link from "next/link";
import type * as React from "react";

import { rentalPath } from "../../lib/paths";
import { rentalRateText } from "../../lib/rentals/rental-labels";
import type { RentalSummary } from "../../lib/rentals/rental-queries";
import type { RentalClock } from "../../lib/rentals/rental-records";
import { rentalWhenWords } from "../../lib/rentals/rental-when";
import { RentalBadges } from "./rental-status-badge";

/** A card's row: a line above the next, tall enough to tap. */
export const CARD_ROW_CLASSES = "flex items-center gap-3 border-t py-2 min-h-15";

/**
 * One rental as a card's row (a car's or a Renter's Now card): `lead` names
 * the other side, its name a link of its own; the When and rate are the
 * row's link to the rental, stretched over the row; its status at the right.
 */
export function RentalRow(props: {
  lead: React.ReactNode;
  /** Who or what the rental is of, for the link's spoken name: "Sam Patel's rental". */
  rentalName: string;
  rental: RentalSummary;
  clock: RentalClock;
}) {
  const { rental } = props;
  // The whole line is the link's words, so its spoken name holds them (WCAG 2.5.3).
  const words = `${rentalWhenWords(rental, props.clock).text} · ${rentalRateText(rental)}`;
  return (
    <li className={cn(ROW_CLASSES, CARD_ROW_CLASSES)}>
      <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <span className="font-bold">{props.lead}</span>
        <RowLink asChild className="text-muted-foreground text-sm">
          <Link href={rentalPath(rental.id)} aria-label={`${props.rentalName}, ${words}`}>
            {words}
          </Link>
        </RowLink>
      </span>
      <RentalBadges rental={rental} />
    </li>
  );
}
