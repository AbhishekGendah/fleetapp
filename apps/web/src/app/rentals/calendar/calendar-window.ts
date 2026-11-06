import {
  addMonths,
  localDateTimeToUtc,
  MILLISECONDS_PER_DAY,
  todayInTimeZone,
} from "@fleetapp/core";

import { CALENDAR_MONTH_PARAM } from "../../../lib/paths";

export const MONTH_PARAM = CALENDAR_MONTH_PARAM;
export const CAR_PARAM = "car";
/** "2026-12": a month as the page address carries it. */
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const MONTH_TEXT_LENGTH = 7;
/** A month grid shows up to a week either side of the month: load those days' bookings too. */
const GRID_EDGE_DAYS = 7;

/** The month a moment falls in, on the Operator's clock. */
export function monthOf(moment: Date, timeZone: string): string {
  return todayInTimeZone(moment, timeZone).slice(0, MONTH_TEXT_LENGTH);
}

/** The month the address asks for, or this month. */
export function chosenMonth(value: string | string[] | undefined, timeZone: string): string {
  return typeof value === "string" && MONTH_PATTERN.test(value)
    ? value
    : monthOf(new Date(), timeZone);
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
