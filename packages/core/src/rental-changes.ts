import { addDays, todayInTimeZone } from "./calendar-dates";
import { MILLISECONDS_PER_DAY } from "./time-units";
import type { RentalStatus, RentalType } from "./rentals";

/**
 * Changes of terms during a rental (docs/plans/phase-3-slice-7.md, 7a).
 * Each is its own record; a weekly rate change waits for the Renter's
 * signature before it counts. Pure: the forms and the server use the same.
 */

export const RENTAL_CHANGE_KINDS = ["end_date", "make_ongoing", "weekly_rate"] as const;
export type RentalChangeKind = (typeof RENTAL_CHANGE_KINDS)[number];

export const RENTAL_CHANGE_KIND_LABELS: Readonly<Record<RentalChangeKind, string>> = {
  end_date: "End date",
  make_ongoing: "Made ongoing",
  weekly_rate: "Weekly rate",
};

export const RENTAL_CHANGE_STATUSES = ["applied", "waiting_for_signature", "withdrawn"] as const;
export type RentalChangeStatus = (typeof RENTAL_CHANGE_STATUSES)[number];

export const RENTAL_CHANGE_STATUS_LABELS: Readonly<Record<RentalChangeStatus, string>> = {
  applied: "In effect",
  waiting_for_signature: "Waiting for signature",
  withdrawn: "Withdrawn",
};

/** End date and kind can change on a booking or a rental that is out; the rate only once it is out. */
const STATUSES_FOR_END_CHANGES: readonly RentalStatus[] = ["booked", "active"];
const STATUSES_FOR_RATE_CHANGES: readonly RentalStatus[] = ["active"];

export function canChangeEnd(status: RentalStatus): boolean {
  return STATUSES_FOR_END_CHANGES.includes(status);
}

export function canChangeRate(status: RentalStatus): boolean {
  return STATUSES_FOR_RATE_CHANGES.includes(status);
}

export type EndChangeProblem = "in_past" | "before_start" | "unchanged";

/**
 * What is wrong with a new end, if anything: it must be in the future (an
 * end now is a return, done with the return checklist), after the start,
 * and different from the end there is.
 */
export function endChangeProblem(
  newEnd: Date,
  rental: { plannedStart: Date; plannedEnd: Date | null },
  now: Date,
): EndChangeProblem | null {
  if (newEnd.getTime() <= now.getTime()) {
    return "in_past";
  }
  if (newEnd.getTime() <= rental.plannedStart.getTime()) {
    return "before_start";
  }
  return rental.plannedEnd?.getTime() === newEnd.getTime() ? "unchanged" : null;
}

/**
 * Days short of the notice the rental's settings ask for, when an ongoing
 * rental is given an end (0 when there is enough). A short-notice end is
 * allowed (the Renter and business may agree it) but warned and logged.
 */
export function noticeDaysShort(
  newEnd: Date,
  rental: { type: RentalType },
  now: Date,
  noticeDays: number,
): number {
  if (rental.type !== "ongoing") {
    return 0;
  }
  const daysGiven = Math.floor((newEnd.getTime() - now.getTime()) / MILLISECONDS_PER_DAY);
  return Math.max(noticeDays - daysGiven, 0);
}

/** The first day a new weekly rate can apply from: tomorrow on the business's calendar. */
export function earliestRateDay(now: Date, timeZone: string): string {
  return addDays(todayInTimeZone(now, timeZone), 1);
}

export type RateChangeProblem = "too_soon" | "unchanged";

export function rateChangeProblem(
  change: { weeklyRateCents: number; appliesFrom: string },
  current: { weeklyRateCents: number },
  earliestDay: string,
): RateChangeProblem | null {
  if (change.appliesFrom < earliestDay) {
    return "too_soon";
  }
  return change.weeklyRateCents === current.weeklyRateCents ? "unchanged" : null;
}
