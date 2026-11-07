import {
  daysBetween,
  formatShortCalendarDate,
  formatTimeInTimeZone,
  idleDays,
  todayInTimeZone,
  VEHICLE_STATUSES_IN_WORKSHOP,
  type VehicleStatus,
} from "@fleetapp/core";

import { dayOf } from "../rentals/rental-when";
import type { RentalClock } from "../rentals/rental-records";

/**
 * What a car is doing now, in the words of the Cars list's Now column and
 * the car page's strip (docs/plans/look-and-feel.md, "Cars and Renters
 * pages"): who has it and since when or when it is back, the workshop and
 * when it is expected back, or how long it has sat and who booked it next.
 * Pure: the page loads the rentals and this only puts them into words.
 */

/** A rental of the car, as much as its words need. */
export interface CarNowRental {
  id: string;
  renterId: string;
  renterName: string;
  plannedStart: Date;
  plannedEnd: Date | null;
  handedOverAt: Date | null;
}

export interface CarNowInput {
  status: VehicleStatus;
  isArchived: boolean;
  statusReason: string | null;
  statusExpectedBack: string | null;
  idleSince: Date;
  /** The rental whose Renter has the car now (their possession is open: rule 15). */
  withRenter: CarNowRental | null;
  /** The car's next booking. */
  nextBooking: CarNowRental | null;
}

/** Each kind names its Renter separately, so a screen can make the name a link. */
export type CarNow =
  /** "Jamie Park, since Fri 6 Nov", "Alex Ng, back today 3:30 pm". */
  | { kind: "with_renter"; rental: CarNowRental; words: string }
  /** "Booked by Riley Chen, Sat 7 Nov": the car goes out today or tomorrow. */
  | { kind: "booked"; rental: CarNowRental; day: string }
  /** "Idle 12 days · booked by Taylor Smith, Tue 17 Nov". */
  | { kind: "idle_then_booked"; rental: CarNowRental; idle: string; day: string }
  /** "Idle 4 days", "Panel repair, back Mon 9 Nov". */
  | { kind: "plain"; words: string };

/** "Idle 12 days": how long a car has sat, on the Operator's calendar. */
export function idleText(since: Date, clock: RentalClock): string {
  const days = idleDays(since, clock.now, clock.timeZone);
  return days === 1 ? "Idle 1 day" : `Idle ${days} days`;
}

/** A booking that starts this soon is what matters about the car, not how long it has sat. */
const BOOKED_SOON_DAYS = 1;

/** When a Renter with the car brings it back: today with the time, late, or since when they have had it. */
function withRenterWords(rental: CarNowRental, clock: RentalClock): string {
  const end = rental.plannedEnd;
  if (end && dayOf(end, clock) === "today") {
    return `back today ${formatTimeInTimeZone(end, clock.timeZone)}`;
  }
  if (end && end < clock.now) {
    return `was due back ${dayOf(end, clock)}`;
  }
  return `since ${dayOf(rental.handedOverAt ?? rental.plannedStart, clock)}`;
}

/** "Panel repair, back Mon 9 Nov"; "was due back" once that day has passed. */
function workshopWords(input: CarNowInput, today: string): string {
  const reason = input.statusReason ?? "In the workshop";
  if (!input.statusExpectedBack) {
    return reason;
  }
  const day = formatShortCalendarDate(input.statusExpectedBack, today);
  return input.statusExpectedBack < today
    ? `${reason}, was due back ${day}`
    : `${reason}, back ${day}`;
}

export function carNowOf(input: CarNowInput, clock: RentalClock): CarNow | null {
  if (input.isArchived) {
    return null;
  }
  if (input.withRenter) {
    return {
      kind: "with_renter",
      rental: input.withRenter,
      words: withRenterWords(input.withRenter, clock),
    };
  }
  const today = todayInTimeZone(clock.now, clock.timeZone);
  if (VEHICLE_STATUSES_IN_WORKSHOP.includes(input.status)) {
    return { kind: "plain", words: workshopWords(input, today) };
  }
  if (input.status !== "available") {
    return null;
  }
  const booking = input.nextBooking;
  if (!booking) {
    return { kind: "plain", words: idleText(input.idleSince, clock) };
  }
  const day = dayOf(booking.plannedStart, clock);
  const daysAway = daysBetween(today, todayInTimeZone(booking.plannedStart, clock.timeZone));
  return daysAway <= BOOKED_SOON_DAYS
    ? { kind: "booked", rental: booking, day }
    : { kind: "idle_then_booked", rental: booking, idle: idleText(input.idleSince, clock), day };
}

/** The Now words as plain text: for the exports, and anywhere a name is not a link. */
export function carNowText(now: CarNow | null): string | null {
  if (!now) {
    return null;
  }
  switch (now.kind) {
    case "with_renter":
      return `${now.rental.renterName}, ${now.words}`;
    case "booked":
      return `Booked by ${now.rental.renterName}, ${now.day}`;
    case "idle_then_booked":
      return `${now.idle} · booked by ${now.rental.renterName}, ${now.day}`;
    case "plain":
      return now.words;
  }
}

/** A phone card's line: "With Jamie Park, since Fri 6 Nov", "Idle 12 days · booked Tue 17 Nov". */
export function carNowShortText(now: CarNow | null): string | null {
  if (now?.kind === "with_renter") {
    return `With ${now.rental.renterName}, ${now.words}`;
  }
  if (now?.kind === "idle_then_booked") {
    return `${now.idle} · booked ${now.day}`;
  }
  return carNowText(now);
}
