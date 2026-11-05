import { TZDate } from "@date-fns/tz";
import { addMinutes, format, subMinutes } from "date-fns";

import { isCalendarDate } from "./calendar-dates";

/**
 * A date and time on a local clock, as a date-and-time box gives it:
 * "2026-10-30T14:15". Moments are stored in UTC and typed on the
 * Operator's clock (rule 10), so these convert between the two, daylight
 * saving included.
 */

const LOCAL_DATE_TIME_FORMAT = "yyyy-MM-dd'T'HH:mm";
const LOCAL_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;
/** How far daylight saving moves Australian clocks: an hour, or half an hour on Lord Howe Island. */
const CLOCK_CHANGE_MINUTES = [60, 30] as const;

/** "YYYY-MM-DDTHH:mm" that is a real date and time of day. */
export function isLocalDateTime(value: string): boolean {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  return match !== null && isCalendarDate(match[1]!);
}

/** A moment as a local date-and-time box shows it, e.g. "2026-10-30T14:15". */
export function utcToLocalDateTime(moment: Date, timeZone: string): string {
  return format(new TZDate(moment, timeZone), LOCAL_DATE_TIME_FORMAT);
}

/**
 * The moment a local clock time names, or null if that time never happens
 * there (the hour skipped when daylight saving starts). When the clocks go
 * back an hour repeats; the first one (still daylight time) is taken.
 */
export function localDateTimeToUtc(localDateTime: string, timeZone: string): Date | null {
  if (!isLocalDateTime(localDateTime)) {
    return null;
  }
  const [datePart = "", timePart = ""] = localDateTime.split("T");
  const [year = 0, month = 1, day = 1] = datePart.split("-").map(Number);
  const [hour = 0, minute = 0] = timePart.split(":").map(Number);
  const moment = TZDate.tz(timeZone, year, month - 1, day, hour, minute);
  // A skipped time is moved on by the clock change, so it no longer reads as typed.
  if (utcToLocalDateTime(moment, timeZone) !== localDateTime) {
    return null;
  }
  // In the repeated hour the same time also happened one clock change earlier: take that one.
  const earlier = CLOCK_CHANGE_MINUTES.map((minutes) => subMinutes(moment, minutes)).find(
    (candidate) => utcToLocalDateTime(candidate, timeZone) === localDateTime,
  );
  return new Date((earlier ?? moment).getTime());
}

/** Whether two moments read the same on a clock in this timezone, e.g. both halves of the repeated hour. */
export function isSameLocalMinute(first: Date, second: Date, timeZone: string): boolean {
  return utcToLocalDateTime(first, timeZone) === utcToLocalDateTime(second, timeZone);
}

/** Which of the two times a clock shows twice as daylight saving ends. */
export const REPEATED_TIME_CHOICES = ["first", "second"] as const;
export type RepeatedTimeChoice = (typeof REPEATED_TIME_CHOICES)[number];

/**
 * The two moments a local clock time names on the night the clocks go back,
 * or null for any other time (review A11-9): the first is still daylight
 * time, the second an hour (half an hour on Lord Howe Island) later.
 */
export function repeatedTimeMoments(
  localDateTime: string,
  timeZone: string,
): Record<RepeatedTimeChoice, Date> | null {
  const first = localDateTimeToUtc(localDateTime, timeZone);
  if (!first) {
    return null;
  }
  const second = CLOCK_CHANGE_MINUTES.map((minutes) => addMinutes(first, minutes)).find(
    (candidate) => utcToLocalDateTime(candidate, timeZone) === localDateTime,
  );
  return second ? { first, second } : null;
}

/** Which of a repeated time this moment is, or null if its time happens once. */
export function repeatedTimeChoiceOf(moment: Date, timeZone: string): RepeatedTimeChoice | null {
  const moments = repeatedTimeMoments(utcToLocalDateTime(moment, timeZone), timeZone);
  if (!moments) {
    return null;
  }
  // Any second within the minute: the box holds only the minute (batch 7 review).
  return moment.getTime() >= moments.second.getTime() ? "second" : "first";
}
