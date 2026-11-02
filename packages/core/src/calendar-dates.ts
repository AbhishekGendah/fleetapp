import { TZDate } from "@date-fns/tz";
import {
  addDays as addDaysTo,
  addMonths as addMonthsTo,
  differenceInCalendarDays,
  format,
  isValid,
  parse,
} from "date-fns";

/**
 * Dates with no time of day (an expiry, a paid date) are kept as
 * "YYYY-MM-DD" text, so they never shift a day with timezones. "Today" is
 * the Operator's today, in their timezone (rule 10).
 */

const ISO_DATE_FORMAT = "yyyy-MM-dd";
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** Plain dates are worked on in UTC, so the server's own timezone never moves them. */
const PLAIN_DATE_ZONE = "UTC";

/** A "YYYY-MM-DD" date as midnight in UTC, for date maths. */
function plainDate(isoDate: string): TZDate {
  const [year = 0, month = 1, day = 1] = isoDate.split("-").map(Number);
  return TZDate.tz(PLAIN_DATE_ZONE, year, month - 1, day);
}

/** Today's date where the Operator is, e.g. "2026-10-29". */
export function todayInTimeZone(moment: Date, timeZone: string): string {
  return format(new TZDate(moment, timeZone), ISO_DATE_FORMAT);
}

/** The date so many days after another. */
export function addDays(isoDate: string, days: number): string {
  return format(addDaysTo(plainDate(isoDate), days), ISO_DATE_FORMAT);
}

/** Whole days from one date to a later one: 0 for the same day, negative if earlier. */
export function daysBetween(fromIsoDate: string, toIsoDate: string): number {
  return differenceInCalendarDays(plainDate(toIsoDate), plainDate(fromIsoDate));
}

/**
 * The same day so many months later, or the month's last day when that month
 * is shorter: 31 Jan + 1 month is 28 Feb (29 in a leap year).
 */
export function addMonths(isoDate: string, months: number): string {
  return format(addMonthsTo(plainDate(isoDate), months), ISO_DATE_FORMAT);
}

/** A real calendar date in "YYYY-MM-DD" form, so "2026-02-30" is refused. */
export function isCalendarDate(value: string): boolean {
  return (
    ISO_DATE_PATTERN.test(value) && isValid(parse(value, ISO_DATE_FORMAT, plainDate("2000-01-01")))
  );
}
