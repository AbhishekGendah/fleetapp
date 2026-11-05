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
