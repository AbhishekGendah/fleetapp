import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

import { todayInTimeZone } from "./calendar-dates";
import { AUSTRALIAN_LOCALE } from "./locale";

/**
 * A moment as the Operator would read it on their own clock (rule 10), e.g.
 * "27 Oct 2026, 2:15 pm AWST". The zone's short name is included because the
 * reader may not be where the Operator is.
 */
export function formatDateTimeInTimeZone(moment: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(AUSTRALIAN_LOCALE, {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(moment);
}

/** A date with no time of day, stored as "2026-11-01", read as "1 Nov 2026" wherever the reader is. */
export function formatCalendarDate(isoDate: string): string {
  return new Intl.DateTimeFormat(AUSTRALIAN_LOCALE, {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

/** A day in words on the Operator's clock, e.g. "Friday 6 November", for emails to Renters. */
export function formatDayInTimeZone(moment: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(AUSTRALIAN_LOCALE, {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(moment);
}

/**
 * The time and day a link stops working, for emails to Renters, e.g.
 * "3:15 pm AEDT, Friday 13 November": a link stops at that time, not at the
 * day's end (review A11-5, batch 7 decision 10).
 */
export function formatLinkExpiryInTimeZone(moment: Date, timeZone: string): string {
  const time = new Intl.DateTimeFormat(AUSTRALIAN_LOCALE, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(moment);
  return `${time}, ${formatDayInTimeZone(moment, timeZone)}`;
}

const SHORT_DAY_FORMAT = "EEE d MMM";
const YEAR_FORMAT = "yyyy";
const CLOCK_TIME_FORMAT = "h:mm aaa";
const MONTH_YEAR_FORMAT = "MMM yyyy";
const YEAR_TEXT_LENGTH = 4;
/** Plain dates are read in UTC, so no timezone moves them a day. */
const PLAIN_DATE_ZONE = "UTC";

/**
 * A date with no time of day as a short line reads it, e.g. "Thu 12 Nov".
 * The year is added only when it is not the Operator's current one, so an
 * expiry from last year never passes for this year's.
 */
export function formatShortCalendarDate(isoDate: string, today: string): string {
  const day = new TZDate(new Date(`${isoDate}T00:00:00Z`), PLAIN_DATE_ZONE);
  const isThisYear = isoDate.slice(0, YEAR_TEXT_LENGTH) === today.slice(0, YEAR_TEXT_LENGTH);
  return isThisYear
    ? format(day, SHORT_DAY_FORMAT)
    : `${format(day, SHORT_DAY_FORMAT)} ${format(day, YEAR_FORMAT)}`;
}

/** The day a moment falls on, on the Operator's clock, as a short line reads it: "Sat 7 Nov". */
export function formatShortDayInTimeZone(moment: Date, timeZone: string, today: string): string {
  return formatShortCalendarDate(todayInTimeZone(moment, timeZone), today);
}

/** The month a moment falls in, on the Operator's clock: "Mar 2026", e.g. since when a Renter has rented. */
export function formatMonthYearInTimeZone(moment: Date, timeZone: string): string {
  return format(new TZDate(moment, timeZone), MONTH_YEAR_FORMAT);
}

/** The time of day on the Operator's clock, e.g. "10:00 am" (rule 10). */
export function formatTimeInTimeZone(moment: Date, timeZone: string): string {
  return format(new TZDate(moment, timeZone), CLOCK_TIME_FORMAT);
}
