import {
  addDays,
  addMonths,
  isCalendarDate,
  isRecordId,
  localDateTimeToUtc,
  MILLISECONDS_PER_DAY,
} from "@fleetapp/core";

import {
  CALENDAR_BY_CAR_VIEW,
  CALENDAR_CAR_PARAM,
  CALENDAR_DAY_PARAM,
  CALENDAR_MONTH_PARAM,
  CALENDAR_VIEW_PARAM,
} from "../../../lib/paths";

/** The By car view's own choices in the address, kept in the browser (timeline-filters). */
export const TIMELINE_SHOW_PARAM = "show";
export const TIMELINE_ZOOM_PARAM = "zoom";
/** What the old timeline's address passes on to the By car view. */
export const TIMELINE_ADDRESS_CHOICES = [TIMELINE_SHOW_PARAM, TIMELINE_ZOOM_PARAM] as const;

/** "2026-12": a month as the page address carries it. */
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_TEXT_LENGTH = 7;
/** A month grid shows up to a week either side of the month: load those days' bookings too. */
const GRID_EDGE_DAYS = 7;
/** By car shows two weeks at a time; previous and next move by as much. */
export const BY_CAR_DAYS = 14;

type SearchParams = Record<string, string | string[] | undefined>;

function single(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return typeof value === "string" ? value : undefined;
}

/** What the Calendar page's address asks for, each checked; anything else is left out. */
export interface CalendarRequest {
  isByCar: boolean;
  /** The day asked for (a real date), if any. */
  day: string | undefined;
  /** The month asked for, if any (the day's month wins). */
  month: string | undefined;
  vehicleId: string | undefined;
}

export function calendarRequestOf(params: SearchParams): CalendarRequest {
  const day = single(params, CALENDAR_DAY_PARAM);
  const month = single(params, CALENDAR_MONTH_PARAM);
  const car = single(params, CALENDAR_CAR_PARAM);
  return {
    isByCar: single(params, CALENDAR_VIEW_PARAM) === CALENDAR_BY_CAR_VIEW,
    day: day && isCalendarDate(day) ? day : undefined,
    month: month && MONTH_PATTERN.test(month) ? month : undefined,
    vehicleId: car && isRecordId(car) ? car : undefined,
  };
}

/** The month the Month view shows: the day's, the one asked for, or this one. */
export function shownMonth(request: CalendarRequest, today: string): string {
  return (request.day ?? request.month ?? today).slice(0, MONTH_TEXT_LENGTH);
}

/** The day the phone's Day by day opens on: the day asked for, today, or the month's first. */
export function shownDay(request: CalendarRequest, today: string): string {
  if (request.day) {
    return request.day;
  }
  const month = shownMonth(request, today);
  return today.startsWith(month) ? today : `${month}-01`;
}

/** The months before and after, for previous and next. */
export function neighbouringMonths(month: string): { previous: string; next: string } {
  const first = `${month}-01`;
  return {
    previous: addMonths(first, -1).slice(0, MONTH_TEXT_LENGTH),
    next: addMonths(first, 1).slice(0, MONTH_TEXT_LENGTH),
  };
}

/** The days so many days before and after, for previous and next. */
export function neighbouringDays(day: string, step: number): { previous: string; next: string } {
  return { previous: addDays(day, -step), next: addDays(day, step) };
}

/** Every moment the month's grid can show, with a week either side. */
export function monthWindow(month: string, timeZone: string): { from: Date; to: Date } {
  const firstDay = `${month}-01`;
  const start = localDateTimeToUtc(`${firstDay}T00:00`, timeZone);
  const end = localDateTimeToUtc(`${addMonths(firstDay, 1)}T00:00`, timeZone);
  if (!start || !end) {
    throw new Error("Midnight on the first of a month always exists in Australian timezones.");
  }
  const edge = GRID_EDGE_DAYS * MILLISECONDS_PER_DAY;
  return { from: new Date(start.getTime() - edge), to: new Date(end.getTime() + edge) };
}
