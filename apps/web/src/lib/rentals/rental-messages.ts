import {
  BUSINESS_DETAIL_NEEDED_LABELS,
  DETAIL_NEEDED_LABELS,
  DIRECT_DEBIT_STATE_LABELS,
  formatCalendarDate,
  bondOnItsWayText,
  formatCents,
  formatDateTimeInTimeZone,
  VEHICLE_STATUS_LABELS,
  type BookingProblem,
} from "@fleetapp/core";

import type { MissingParty } from "./booking-checks";
import { isStillOutClash, type NewHoldClash } from "./car-holds";

/** Why a business's driver can't be named, in words, for the form and the rental page. */
export const MISSING_DRIVER_MESSAGES: Readonly<
  Record<Exclude<MissingParty, "renter_not_found" | "car_not_found">, string>
> = {
  driver_not_found: "That driver could not be found. Choose another driver.",
  driver_archived: "That driver has been archived. Restore them first, or choose another driver.",
  driver_not_current:
    "That person no longer drives for this business. Choose another driver, or add them again on its Drivers tab.",
  driver_waiting_review:
    "That driver sent details that wait for review. Review them on the driver's page before naming them, or choose another driver.",
};

/** Why a rental's page can't check its Renter, driver or car: one is archived or gone. */
export const RENTAL_PARTY_MISSING_MESSAGES: Readonly<Record<MissingParty, string>> = {
  car_not_found: "The car has been archived. Restore it, or cancel this rental.",
  renter_not_found: "The Renter has been archived. Restore them, or cancel this rental.",
  ...MISSING_DRIVER_MESSAGES,
};

/**
 * One booking problem in plain words, for the form and the rental page. On a
 * business's rental the licence and age are the driver's, and said so.
 */
export function bookingProblemMessage(problem: BookingProblem, isBusinessRental = false): string {
  const whose = isBusinessRental ? "The driver's" : "The Renter's";
  const who = isBusinessRental ? "The driver" : "The Renter";
  switch (problem.code) {
    case "do_not_rent":
      return isBusinessRental
        ? "This business or its driver is marked Do not rent."
        : "This Renter is marked Do not rent.";
    case "business_details_missing":
      return `Still needed on the business's details before the car is handed over: ${problem.missing
        .map((detail) => BUSINESS_DETAIL_NEEDED_LABELS[detail])
        .join(", ")}.`;
    case "driver_not_named":
      return "No driver named yet. Name one before the handover: the driver signs for the car.";
    case "driver_has_other_car":
      return `The driver already has ${problem.regos.join(", ")} out.`;
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
      return `${whose} licence expires on ${formatCalendarDate(problem.expiresOn)}, before the rental starts.`;
    case "under_minimum_age":
      return `${who} is under ${problem.minimumAge}, your minimum age.`;
    case "provisional_licence":
      return `${who} has a provisional licence, which your settings do not allow.`;
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
      return `${whose} licence expires on ${formatCalendarDate(problem.expiresOn)}, during the rental.`;
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
