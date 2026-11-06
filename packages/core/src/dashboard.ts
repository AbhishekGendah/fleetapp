import { addDays, daysBetween, todayInTimeZone } from "./calendar-dates";
import { localDateTimeToUtc } from "./local-date-time";
import type { RentalStatus } from "./rentals";

/** "This week" on the dashboard: today and the six days after it. */
export const DASHBOARD_WEEK_DAYS = 7;
const START_OF_DAY = "T00:00";

/** The moment a day starts where the Operator is. */
export function startOfDayIn(isoDate: string, timeZone: string): Date {
  const moment = localDateTimeToUtc(`${isoDate}${START_OF_DAY}`, timeZone);
  if (!moment) {
    // Australian clocks change at 2 or 3am, never at midnight.
    throw new Error(`Midnight did not happen on ${isoDate} in ${timeZone}.`);
  }
  return moment;
}

/** The Operator's today, and where today and this week end, as moments (rule 10). */
export interface DashboardWindow {
  today: string;
  now: Date;
  todayEnds: Date;
  weekEnds: Date;
}

export function dashboardWindow(now: Date, timeZone: string): DashboardWindow {
  const today = todayInTimeZone(now, timeZone);
  return {
    today,
    now,
    todayEnds: startOfDayIn(addDays(today, 1), timeZone),
    weekEnds: startOfDayIn(addDays(today, DASHBOARD_WEEK_DAYS), timeZone),
  };
}

/** Where a booked or active rental stands this week, most urgent first. */
export const RENTAL_MOMENTS = [
  "overdue",
  "late_pickup",
  "returning_today",
  "pickup_today",
  "ending_this_week",
  "starting_this_week",
] as const;
export type RentalMoment = (typeof RENTAL_MOMENTS)[number];
/** A booking that has not yet been handed over can still have problems to sort out. */
export const MOMENTS_BEFORE_HANDOVER: readonly RentalMoment[] = [
  "late_pickup",
  "pickup_today",
  "starting_this_week",
];

/** Which moment, if any, a rental is at this week: none when nothing happens to it. */
export function rentalMomentOf(
  rental: { status: RentalStatus; plannedStart: Date; plannedEnd: Date | null },
  window: DashboardWindow,
): RentalMoment | null {
  if (rental.status === "active") {
    if (rental.plannedEnd === null || rental.plannedEnd >= window.weekEnds) {
      return null;
    }
    if (rental.plannedEnd < window.now) {
      return "overdue";
    }
    return rental.plannedEnd < window.todayEnds ? "returning_today" : "ending_this_week";
  }
  if (rental.status !== "booked" || rental.plannedStart >= window.weekEnds) {
    return null;
  }
  if (rental.plannedStart < window.now) {
    return "late_pickup";
  }
  return rental.plannedStart < window.todayEnds ? "pickup_today" : "starting_this_week";
}

/** Whole days a car has sat since a moment, counted on the Operator's calendar. */
export function idleDays(since: Date, now: Date, timeZone: string): number {
  return Math.max(0, daysBetween(todayInTimeZone(since, timeZone), todayInTimeZone(now, timeZone)));
}
