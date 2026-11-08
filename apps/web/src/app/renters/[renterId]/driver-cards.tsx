import { formatShortDayInTimeZone, todayInTimeZone } from "@fleetapp/core";
import { Badge } from "@fleetapp/ui/badge";
import { cn } from "@fleetapp/ui/cn";
import { ROW_CLASSES, RowLink } from "@fleetapp/ui/row-link";
import Link from "next/link";

import { SectionCard } from "../../../components/section-card";
import { rentalPath, renterPath } from "../../../lib/paths";
import type { CarDriven, DrivesFor } from "../../../lib/renters/organisation-driver-queries";
import { CARD_ROW_CLASSES } from "../../rentals/rental-row";
import { QUIET_LINE_CLASSES } from "./card-lines";

/** How many of the cars a person drove the Overview lists, newest first. */
const CARS_SHOWN = 5;

function dayIn(timeZone: string) {
  const today = todayInTimeZone(new Date(), timeZone);
  return (moment: Date) => formatShortDayInTimeZone(moment, timeZone, today);
}

/** The businesses a person drives for now, then those they drove for (7 Nov 2026 mockups). */
export function DrivesForCard(props: { drivesFor: readonly DrivesFor[]; timeZone: string }) {
  if (props.drivesFor.length === 0) {
    return null;
  }
  const dayOf = dayIn(props.timeZone);
  return (
    <SectionCard heading="Drives for">
      <ul aria-label="Drives for">
        {props.drivesFor.map((link) => (
          <li key={link.linkId} className={cn(ROW_CLASSES, CARD_ROW_CLASSES)}>
            <span className="flex min-w-0 flex-1 flex-col">
              <RowLink asChild className="text-teal font-extrabold">
                <Link href={renterPath(link.organisationId)}>{link.name}</Link>
              </RowLink>
              <span className="text-muted-foreground text-sm">
                {link.removedAt
                  ? `${dayOf(link.addedAt)} to ${dayOf(link.removedAt)}`
                  : `Since ${dayOf(link.addedAt)}`}
              </span>
            </span>
            {link.removedAt ? <Badge>Past</Badge> : <Badge tone="good">Current</Badge>}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

/**
 * Every time the person had a car, from the handovers, returns and swaps
 * they signed (the possession records, rule 15): whose car it was, and when.
 * Shown once they have driven a business's car; their own rentals are on
 * the Rentals tab.
 */
export function CarsDrivenCard(props: { cars: readonly CarDriven[]; timeZone: string }) {
  if (!props.cars.some((car) => car.businessName !== null)) {
    return null;
  }
  const dayOf = dayIn(props.timeZone);
  return (
    <SectionCard heading="Cars driven">
      <p className={QUIET_LINE_CLASSES}>From the handovers, returns and swaps they signed.</p>
      <ul aria-label="Cars driven">
        {props.cars.slice(0, CARS_SHOWN).map((car) => {
          const when = `${dayOf(car.startedAt)} to ${car.endedAt ? dayOf(car.endedAt) : "now"}`;
          return (
            <li key={car.possessionId} className={cn(ROW_CLASSES, CARD_ROW_CLASSES)}>
              <span className="flex min-w-0 flex-1 flex-col">
                <RowLink asChild className="font-bold">
                  <Link
                    href={rentalPath(car.rentalId)}
                    aria-label={`Rental of ${car.rego}, ${when}`}
                  >
                    {car.rego} · {car.make} {car.model}
                  </Link>
                </RowLink>
                <span className="text-muted-foreground text-sm">
                  {car.businessName ? `for ${car.businessName}` : "Their own rental"} · {when}
                </span>
              </span>
              {car.endedAt ? null : <Badge tone="out">Out</Badge>}
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
