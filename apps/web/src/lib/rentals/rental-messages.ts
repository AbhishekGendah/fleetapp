import {
  DETAIL_NEEDED_LABELS,
  DIRECT_DEBIT_STATE_LABELS,
  formatCalendarDate,
  bondOnItsWayText,
  formatCents,
  formatDateTimeInTimeZone,
  VEHICLE_STATUS_LABELS,
  type BookingProblem,
} from "@fleetapp/core";

import { isStillOutClash, type NewHoldClash } from "./car-holds";

/** One booking problem in plain words, for the form and the rental page. */
export function bookingProblemMessage(problem: BookingProblem): string {
  switch (problem.code) {
    case "do_not_rent":
      return "This Renter is marked Do not rent.";
    case "car_not_rentable":
      return `This car is ${VEHICLE_STATUS_LABELS[problem.carStatus].toLowerCase()}, so it cannot be booked.`;
    case "car_not_ready":
      return `This car is ${VEHICLE_STATUS_LABELS[problem.carStatus].toLowerCase()}: it can be booked, but not handed over until it is back.`;
    case "car_still_out":
      return "This car is still out with another Renter. Record its return before handing it over.";
    case "no_insurance":
      return `No insurance policy covering this car on ${formatCalendarDate(problem.coverOn)} is on file. Add it on the car's Insurance tab, or give a reason at handover.`;
    case "no_rego":
      return `No rego covering this car on ${formatCalendarDate(problem.coverOn)} is on file. Add it on the car's Rego tab, or give a reason at handover.`;
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
    case "bond_short":
      return [
        `Bond still to receive before handover: ${formatCents(problem.owingCents)}.`,
        bondOnItsWayText(problem.onItsWayCents),
      ]
        .filter(Boolean)
        .join(" ");
    case "direct_debit_missing":
      return problem.state === "waiting"
        ? "The Renter's direct debit is still being checked by Stripe. Hand over once it is set up, or give a reason."
        : `The Renter's direct debit is ${DIRECT_DEBIT_STATE_LABELS[problem.state].toLowerCase()}. Send them the link to set it up before handover.`;
    case "licence_expires_during":
      return `The Renter's licence expires on ${formatCalendarDate(problem.expiresOn)}, during the rental.`;
  }
}

/** Which booking already has the car, or that it is still out late, so the Operator can look at it. */
export function bookingClashMessage(clash: NewHoldClash | null, timeZone: string): string {
  if (!clash) {
    return "Someone booked this car for some of that time just now. Choose other dates or another car.";
  }
  if (isStillOutClash(clash)) {
    // Other dates would not help: nobody knows when it comes back (find-a-car.md, decision 5).
    return `This car is still out: it was due back ${formatDateTimeInTimeZone(clash.dueBack, timeZone)} and hasn't been returned yet. Choose another car, or record its return first.`;
  }
  const from = formatDateTimeInTimeZone(clash.plannedStart, timeZone);
  const until = clash.plannedEnd
    ? `until ${formatDateTimeInTimeZone(clash.plannedEnd, timeZone)}`
    : "with no end date (ongoing)";
  return `This car is already booked from ${from} ${until}. Choose other dates or another car.`;
}
