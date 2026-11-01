import {
  DETAIL_NEEDED_LABELS,
  formatCalendarDate,
  formatDateTimeInTimeZone,
  VEHICLE_STATUS_LABELS,
  type BookingProblem,
} from "@fleetapp/core";

import type { BookingClash } from "./car-holds";

/** One booking problem in plain words, for the form and the rental page. */
export function bookingProblemMessage(problem: BookingProblem): string {
  switch (problem.code) {
    case "do_not_rent":
      return "This Renter is marked Do not rent.";
    case "car_not_rentable":
      return `This car is ${VEHICLE_STATUS_LABELS[problem.carStatus].toLowerCase()}, so it cannot be booked.`;
    case "car_not_ready":
      return `This car is ${VEHICLE_STATUS_LABELS[problem.carStatus].toLowerCase()}: it can be booked, but not handed over until it is back.`;
    case "details_missing":
      return `Still needed before the car is handed over: ${problem.missing
        .map((detail) => DETAIL_NEEDED_LABELS[detail].toLowerCase())
        .join(", ")}.`;
    case "licence_expired_by_start":
      return `The Renter's licence expires on ${formatCalendarDate(problem.expiresOn)}, before the rental starts.`;
    case "under_minimum_age":
      return `The Renter is under ${problem.minimumAge}, your minimum age.`;
    case "provisional_licence":
      return "The Renter has a provisional licence, which your settings do not allow.";
    case "licence_expires_during":
      return `The Renter's licence expires on ${formatCalendarDate(problem.expiresOn)}, during the rental.`;
  }
}

/** Which booking already has the car, so the Operator can look at it. */
export function bookingClashMessage(clash: BookingClash | null, timeZone: string): string {
  if (!clash) {
    return "Someone booked this car for some of that time just now. Choose other dates or another car.";
  }
  const from = formatDateTimeInTimeZone(clash.plannedStart, timeZone);
  const until = clash.plannedEnd
    ? `until ${formatDateTimeInTimeZone(clash.plannedEnd, timeZone)}`
    : "with no end date (ongoing)";
  return `This car is already booked from ${from} ${until}. Choose other dates or another car.`;
}
