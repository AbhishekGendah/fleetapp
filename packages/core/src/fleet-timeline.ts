import { addDays, isCalendarDate, todayInTimeZone, weekdayOfDate } from "./calendar-dates";
import type { VehicleStatus } from "./vehicles";

const DAYS_PER_WEEK = 7;
/** The stretch loaded at once: a quarter back, half a year ahead, scrolled through smoothly. */
export const TIMELINE_WEEKS_BEFORE = 13;
export const TIMELINE_WEEKS_AFTER = 26;

/** The Monday on or before a date. */
export function mondayOf(isoDate: string): string {
  return addDays(isoDate, 1 - weekdayOfDate(isoDate));
}

export interface TimelineWindow {
  /** The first day loaded, a Monday. */
  startDate: string;
  days: number;
  /** The day it opens scrolled to: the one asked for, or today. */
  focusDate: string;
  today: string;
}

/**
 * The stretch the timeline loads around the day asked for (today if none,
 * or one that is not a real date), on the Operator's clock (rule 10).
 */
export function timelineWindow(
  asked: string | undefined,
  now: Date,
  timeZone: string,
): TimelineWindow {
  const today = todayInTimeZone(now, timeZone);
  const focusDate = asked && isCalendarDate(asked) ? asked : today;
  return {
    startDate: addDays(mondayOf(focusDate), -TIMELINE_WEEKS_BEFORE * DAYS_PER_WEEK),
    days: (TIMELINE_WEEKS_BEFORE + TIMELINE_WEEKS_AFTER) * DAYS_PER_WEEK,
    focusDate,
    today,
  };
}

/** How close the timeline is zoomed: each sets what one cell is and how many fill the screen. */
export const TIMELINE_ZOOMS = ["days", "weeks", "months"] as const;
export type TimelineZoom = (typeof TIMELINE_ZOOMS)[number];

export const TIMELINE_ZOOM_LABELS: Readonly<Record<TimelineZoom, string>> = {
  days: "Days",
  weeks: "Weeks",
  months: "Months",
};

export interface TimelineZoomLevel {
  /** What one cell is. */
  cell: "day" | "week";
  /** About how many cells fill the box: two weeks, two months, half a year. */
  cellsAcross: number;
  /** Narrower than this and the cells are swiped instead of shrunk: readable, and dates tappable. */
  minimumCellWidth: number;
}

export const TIMELINE_ZOOM_LEVELS: Readonly<Record<TimelineZoom, TimelineZoomLevel>> = {
  days: { cell: "day", cellsAcross: 14, minimumCellWidth: 44 },
  weeks: { cell: "day", cellsAcross: 56, minimumCellWidth: 16 },
  months: { cell: "week", cellsAcross: 26, minimumCellWidth: 24 },
};

export function isTimelineZoom(value: string): value is TimelineZoom {
  return (TIMELINE_ZOOMS as readonly string[]).includes(value);
}

/** A cell's width in pixels for a box this wide: filling it, but never below the readable width. */
export function timelineCellWidth(
  boxWidth: number,
  rowHeaderWidth: number,
  zoom: TimelineZoom,
): number {
  const level = TIMELINE_ZOOM_LEVELS[zoom];
  const fitted = Math.floor((boxWidth - rowHeaderWidth) / level.cellsAcross);
  return Math.max(level.minimumCellWidth, fitted);
}

/** The status filter's choices: Workshop covers both kinds of time off the road. */
export const TIMELINE_STATUS_GROUPS = ["all", "available", "out", "workshop"] as const;
export type TimelineStatusGroup = (typeof TIMELINE_STATUS_GROUPS)[number];

export const TIMELINE_STATUS_GROUP_LABELS: Readonly<Record<TimelineStatusGroup, string>> = {
  all: "All",
  available: "Available",
  out: "Out",
  workshop: "Workshop",
};

const STATUSES_IN_GROUP: Readonly<
  Record<Exclude<TimelineStatusGroup, "all">, readonly VehicleStatus[]>
> = {
  available: ["available"],
  out: ["rented"],
  workshop: ["in_service", "off_road"],
};

export function isTimelineStatusGroup(value: string): value is TimelineStatusGroup {
  return (TIMELINE_STATUS_GROUPS as readonly string[]).includes(value);
}

/** Whether a car with this status is shown under the chosen group. */
export function isInStatusGroup(status: VehicleStatus, group: TimelineStatusGroup): boolean {
  return group === "all" || STATUSES_IN_GROUP[group].includes(status);
}
