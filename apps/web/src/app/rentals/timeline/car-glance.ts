import {
  formatCalendarDate,
  formatDateTimeInTimeZone,
  formatKilometres,
  VEHICLE_STATUS_LABELS,
  type VehicleStatus,
} from "@fleetapp/core";

import { carPath } from "../../../lib/paths";
import type { CalendarBooking } from "../../../lib/rentals/rental-queries";
import type { VehicleSummary } from "../../../lib/vehicles/vehicle-queries";

const NOT_RECORDED = "Not recorded";

/** A car as the timeline's quick view shows it, its dates already on the Operator's clock (rule 10). */
export interface CarGlance {
  id: string;
  rego: string;
  status: VehicleStatus;
  /** Matched by the search box: rego, make, model, variant, colour. */
  searchText: string;
  /** For the car picker's second line. */
  description: string;
  heading: string;
  lines: readonly (readonly [label: string, value: string])[];
  carHref: string;
}

function statusLine(car: VehicleSummary): string {
  const label = VEHICLE_STATUS_LABELS[car.status];
  if (!car.statusReason) {
    return label;
  }
  const back = car.statusExpectedBack
    ? `, expected back ${formatCalendarDate(car.statusExpectedBack)}`
    : "";
  return `${label}: ${car.statusReason}${back}`;
}

/** The car's next booking that has not started, if any. */
function nextBookingLine(
  car: VehicleSummary,
  bookings: readonly CalendarBooking[],
  context: { now: Date; timeZone: string },
): string {
  const next = bookings
    .filter((booking) => booking.vehicleId === car.id && booking.heldFrom > context.now)
    .sort((first, second) => first.heldFrom.getTime() - second.heldFrom.getTime())[0];
  return next
    ? `${next.renterFullName}, from ${formatDateTimeInTimeZone(next.heldFrom, context.timeZone)}`
    : "None booked";
}

export function carGlanceOf(
  car: VehicleSummary,
  bookings: readonly CalendarBooking[],
  context: { now: Date; timeZone: string },
): CarGlance {
  const makeModel = [car.make, car.model, car.variant].filter(Boolean).join(" ");
  const withRenter =
    car.renterWithCar && car.withRenterSince
      ? `${car.renterWithCar}, since ${formatDateTimeInTimeZone(car.withRenterSince, context.timeZone)}`
      : "Nobody";
  return {
    id: car.id,
    rego: car.rego,
    status: car.status,
    searchText: [car.rego, makeModel, car.colour ?? ""].join(" ").toLowerCase(),
    description: `${makeModel} · ${VEHICLE_STATUS_LABELS[car.status]}`,
    heading: `${car.rego} · ${car.regoState}`,
    lines: [
      ["Car", [makeModel, String(car.year), car.colour].filter(Boolean).join(" · ")],
      ["Status", statusLine(car)],
      [
        "Kilometres",
        car.currentKilometres === null ? NOT_RECORDED : formatKilometres(car.currentKilometres),
      ],
      ["Rego expires", car.regoExpiresOn ? formatCalendarDate(car.regoExpiresOn) : NOT_RECORDED],
      [
        "Insurance ends",
        car.insuranceEndsOn ? formatCalendarDate(car.insuranceEndsOn) : NOT_RECORDED,
      ],
      ["With", withRenter],
      ["Next booking", nextBookingLine(car, bookings, context)],
    ],
    carHref: carPath(car.id),
  };
}
