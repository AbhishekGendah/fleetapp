import {
  addDays,
  formatTimeInTimeZone,
  mondayOf,
  renterFirstName,
  todayInTimeZone,
} from "@fleetapp/core";

import type { CalendarBooking } from "./rental-queries";

/**
 * The Calendar page's handovers and returns (docs/plans/look-and-feel.md,
 * "Calendar page"), each on its day on the Operator's clock (rule 10). Pure:
 * the page loads the bookings, these put them on days and into words.
 */

export type CalendarMomentKind = "handover" | "return";

export const CALENDAR_MOMENT_LABELS: Readonly<Record<CalendarMomentKind, string>> = {
  handover: "Handover",
  return: "Return",
};

export interface CalendarMoment {
  key: string;
  rentalId: string;
  renterId: string;
  vehicleId: string;
  kind: CalendarMomentKind;
  at: Date;
  /** "2026-11-07", on the Operator's clock. */
  day: string;
  /** "10:00 am". */
  time: string;
  renterName: string;
  /** For the month grid's short labels: "Jamie". */
  renterFirstName: string;
  rego: string;
  makeModel: string;
}

const DAYS_PER_WEEK = 7;

/**
 * Each booking's handover and return that falls in the window, earliest
 * first. An ongoing rental has only its handover.
 */
export function calendarMoments(
  bookings: readonly CalendarBooking[],
  window: { from: Date; to: Date },
  timeZone: string,
): CalendarMoment[] {
  return bookings
    .flatMap((booking) => {
      const ends: readonly [CalendarMomentKind, Date | null][] = [
        ["handover", booking.heldFrom],
        ["return", booking.heldUntil],
      ];
      return ends.flatMap(([kind, at]) =>
        at && at >= window.from && at < window.to
          ? [
              {
                key: `${booking.rentalId}-${booking.vehicleId}-${kind}`,
                rentalId: booking.rentalId,
                renterId: booking.renterId,
                vehicleId: booking.vehicleId,
                kind,
                at,
                day: todayInTimeZone(at, timeZone),
                time: formatTimeInTimeZone(at, timeZone),
                renterName: booking.renterFullName,
                renterFirstName: renterFirstName(
                  booking.renterFullName,
                  booking.renterPreferredName,
                ),
                rego: booking.rego,
                makeModel: `${booking.make} ${booking.model}`,
              },
            ]
          : [],
      );
    })
    .sort((first, second) => first.at.getTime() - second.at.getTime());
}

/** The month grid's label: "10:00 am Handover · Jamie · 1ABC234". */
export function momentLabel(moment: CalendarMoment): string {
  return `${moment.time} ${CALENDAR_MOMENT_LABELS[moment.kind]} · ${moment.renterFirstName} · ${moment.rego}`;
}

/** The moments on each day, in time order; a day with none is not listed. */
export function momentsByDay(
  moments: readonly CalendarMoment[],
): ReadonlyMap<string, readonly CalendarMoment[]> {
  const byDay = new Map<string, CalendarMoment[]>();
  for (const moment of moments) {
    byDay.set(moment.day, [...(byDay.get(moment.day) ?? []), moment]);
  }
  return byDay;
}

/** The seven days, Monday first, of the week a day is in. */
export function weekDays(day: string): string[] {
  const monday = mondayOf(day);
  return Array.from({ length: DAYS_PER_WEEK }, (_, offset) => addDays(monday, offset));
}

const PLAIN_DATE = { timeZone: "UTC" } as const;
const DAY_OF_MONTH = new Intl.DateTimeFormat("en-AU", { ...PLAIN_DATE, day: "numeric" });
const DAY_AND_MONTH = new Intl.DateTimeFormat("en-AU", {
  ...PLAIN_DATE,
  day: "numeric",
  month: "long",
});
const SHORT_DAY_AND_MONTH = new Intl.DateTimeFormat("en-AU", {
  ...PLAIN_DATE,
  day: "numeric",
  month: "short",
});
const MONTH_AND_YEAR = new Intl.DateTimeFormat("en-AU", {
  ...PLAIN_DATE,
  month: "long",
  year: "numeric",
});

function asDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/** "November 2026". */
export function monthLabel(month: string): string {
  return MONTH_AND_YEAR.format(asDate(`${month}-01`));
}

/** "2 to 8 November", or "30 Nov to 6 Dec" across two months. */
export function spanLabel(firstDay: string, lastDay: string): string {
  if (firstDay.slice(0, 7) === lastDay.slice(0, 7)) {
    return `${DAY_OF_MONTH.format(asDate(firstDay))} to ${DAY_AND_MONTH.format(asDate(lastDay))}`;
  }
  return `${SHORT_DAY_AND_MONTH.format(asDate(firstDay))} to ${SHORT_DAY_AND_MONTH.format(asDate(lastDay))}`;
}
