import { formatShortCalendarDate, type ExpiryStatus } from "@fleetapp/core";

import type { RentalClock } from "../rentals/rental-records";
import { carNowOf, carNowText, type CarNow, type CarNowRental } from "./car-now";
import { withExpiryStatuses, type ExpiryContext, type WithExpiryStatuses } from "./expiry-columns";
import type { VehicleSummary } from "./vehicle-queries";

/** Who has each car now and its next booking, as loaded for a page of cars. */
export interface CarRentalsNow {
  withRenter: CarNowRental | null;
  nextBooking: CarNowRental | null;
}

export type CarListRow = WithExpiryStatuses<VehicleSummary> & {
  /** What the car is doing now, for the Now column; null when nothing is worth saying. */
  now: CarNow | null;
  /** The same as plain text, for the exports. */
  nowText: string | null;
  /** A phone card's paperwork line, when the rego or insurance needs a look: "Rego due Thu 12 Nov". */
  paperworkAlert: string | null;
};

type PaperworkDates = Pick<
  CarListRow,
  "isRegoOnDirectDebit" | "regoExpiresOn" | "regoStatus" | "insuranceEndsOn" | "insuranceStatus"
>;

/** "Rego due Thu 12 Nov", "Rego expired", "No rego"; null while it is fine. */
function paperAlert(
  paper: string,
  date: string | null,
  status: ExpiryStatus,
  today: string,
): string | null {
  if (!date) {
    return `No ${paper.toLowerCase()}`;
  }
  if (status === "expired") {
    return `${paper} expired`;
  }
  return status === "due_soon" ? `${paper} due ${formatShortCalendarDate(date, today)}` : null;
}

/** The first paper that needs a look: rego, then insurance. A rego on direct debit is fine. */
export function carPaperworkAlert(car: PaperworkDates, today: string): string | null {
  const rego = car.isRegoOnDirectDebit
    ? null
    : paperAlert("Rego", car.regoExpiresOn, car.regoStatus, today);
  return rego ?? paperAlert("Insurance", car.insuranceEndsOn, car.insuranceStatus, today);
}

/** Sold, written off or archived cars need no rego or insurance. */
export function isInFleet(car: Pick<VehicleSummary, "archivedAt" | "status">): boolean {
  return car.archivedAt === null && car.status !== "sold" && car.status !== "written_off";
}

/** The cars list's rows as the screen and the exports show them. */
export function carListRows(
  cars: readonly VehicleSummary[],
  rentalsByCar: ReadonlyMap<string, CarRentalsNow>,
  expiry: ExpiryContext,
  clock: RentalClock,
): CarListRow[] {
  return withExpiryStatuses(cars, expiry).map((car) => {
    const rentals = rentalsByCar.get(car.id);
    const now = carNowOf(
      {
        status: car.status,
        isArchived: car.archivedAt !== null,
        statusReason: car.statusReason,
        statusExpectedBack: car.statusExpectedBack,
        idleSince: car.idleSince,
        withRenter: rentals?.withRenter ?? null,
        nextBooking: rentals?.nextBooking ?? null,
      },
      clock,
    );
    return {
      ...car,
      now,
      nowText: carNowText(now),
      paperworkAlert: isInFleet(car) ? carPaperworkAlert(car, expiry.today) : null,
    };
  });
}
