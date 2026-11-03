import { addDays, daysBetween, isCalendarDate, todayInTimeZone } from "./calendar-dates";

/** Four weeks: enough to see who is out and what is coming, narrow enough to read. */
export const TIMELINE_DAYS = 28;
/** Earlier and Later move a week at a time. */
export const TIMELINE_STEP_DAYS = 7;
const DAYS_PER_WEEK = 7;
/** 1 Jan 2024 was a Monday: any date's weekday is counted from it. */
const KNOWN_MONDAY = "2024-01-01";

/** The Monday on or before a date. */
export function mondayOf(isoDate: string): string {
  const weekday =
    ((daysBetween(KNOWN_MONDAY, isoDate) % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  return addDays(isoDate, -weekday);
}

/**
 * The timeline's first day: the Monday of the week asked for, never before
 * this week (bookings that are over are not kept as holds, so earlier weeks
 * would look empty), on the Operator's clock (rule 10).
 */
export function timelineStart(asked: string | undefined, now: Date, timeZone: string): string {
  const thisWeek = mondayOf(todayInTimeZone(now, timeZone));
  if (!asked || !isCalendarDate(asked)) {
    return thisWeek;
  }
  const askedWeek = mondayOf(asked);
  return askedWeek < thisWeek ? thisWeek : askedWeek;
}
