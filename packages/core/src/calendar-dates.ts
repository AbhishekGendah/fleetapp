/**
 * Dates with no time of day (an expiry, a paid date) are kept as
 * "YYYY-MM-DD" text, so they never shift a day with timezones. "Today" is
 * the Operator's today, in their timezone (rule 10).
 */

const MILLISECONDS_PER_DAY = 86_400_000;

/** Today's date where the Operator is, e.g. "2026-10-29". */
export function todayInTimeZone(moment: Date, timeZone: string): string {
  // en-CA writes dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(moment);
}

/** The date so many days after another. */
export function addDays(isoDate: string, days: number): string {
  const moment = new Date(`${isoDate}T00:00:00Z`);
  return new Date(moment.getTime() + days * MILLISECONDS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days from one date to another: negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) /
      MILLISECONDS_PER_DAY,
  );
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in "YYYY-MM-DD" form, so "2026-02-30" is refused. */
export function isCalendarDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  const moment = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(moment.getTime()) && moment.toISOString().slice(0, 10) === value;
}
