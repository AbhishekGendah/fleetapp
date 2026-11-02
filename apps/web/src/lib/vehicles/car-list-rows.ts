import { formatCalendarDate, idleDays, todayInTimeZone } from "@fleetapp/core";

import type { RentalClock } from "../rentals/rental-records";
import { withExpiryStatuses, type ExpiryContext, type WithExpiryStatuses } from "./expiry-columns";
import type { VehicleSummary } from "./vehicle-queries";

export type CarListRow = WithExpiryStatuses<VehicleSummary> & {
  /** "Aisha Rahman, since 30 Oct 2026", "Idle 12 days", or null. */
  whereabouts: string | null;
};

/** Where a car is now in a few words: with whom, or how long it has sat. */
export function carWhereaboutsText(car: VehicleSummary, clock: RentalClock): string | null {
  if (car.renterWithCar && car.withRenterSince) {
    const since = formatCalendarDate(todayInTimeZone(car.withRenterSince, clock.timeZone));
    return `${car.renterWithCar}, since ${since}`;
  }
  if (car.status !== "available" || car.archivedAt) {
    return null;
  }
  return idleText(car.idleSince, clock);
}

/** "Idle 12 days": how long a car has sat, on the Operator's calendar. */
export function idleText(since: Date, clock: RentalClock): string {
  const days = idleDays(since, clock.now, clock.timeZone);
  return days === 1 ? "Idle 1 day" : `Idle ${days} days`;
}

/** The cars list's rows as the screen and the exports show them. */
export function carListRows(
  cars: readonly VehicleSummary[],
  expiry: ExpiryContext,
  clock: RentalClock,
): CarListRow[] {
  return withExpiryStatuses(cars, expiry).map((car) => ({
    ...car,
    whereabouts: carWhereaboutsText(car, clock),
  }));
}
