"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import enAuLocale from "@fullcalendar/react/locales/en-au";
import classicThemePlugin from "@fullcalendar/react/themes/classic";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import * as React from "react";

import "./bookings-calendar.css";

import { todayInTimeZone } from "@fleetapp/core";

import { cn } from "../lib/utils";

/** A handover (teal) or a return (amber), as the dashboard's Today card says them. */
export type CalendarEntryTone = "handover" | "return";

export interface CalendarEntry {
  id: string;
  /** e.g. "10:00 am Handover · Jamie · 1ABC234". */
  title: string;
  /** The day it is on, on the Operator's clock: "2026-11-06". */
  date: string;
  /** Its place in the day, e.g. its moment in milliseconds: the earliest first. */
  order: number;
  /** The rental's page. */
  href: string;
  tone: CalendarEntryTone;
}

export interface BookingsCalendarProps {
  entries: readonly CalendarEntry[];
  /** The Operator's timezone: today is their today (rule 10). */
  timeZone: string;
  /** The month shown, "2026-11". The page moves between months; the grid has no buttons of its own. */
  month: string;
  /** A day's number pressed: e.g. to open that day ("2026-11-07"). */
  onDayChosen: (date: string) => void;
  /** The day asked for, ringed. */
  chosenDay?: string;
}

const TONE_COLOURS: Readonly<Record<CalendarEntryTone, { color: string; contrastColor: string }>> =
  {
    handover: { color: "var(--color-out-soft)", contrastColor: "var(--color-primary)" },
    return: { color: "var(--color-attention-soft)", contrastColor: "var(--color-attention)" },
  };

/**
 * The month on FullCalendar's free (MIT) month grid, in the 6 Nov 2026 look:
 * Monday first, today circled navy, each handover and return a label that
 * opens its rental, and each day's number a link to that day. For a
 * computer: on a phone the page shows its day-by-day view instead.
 */
export function BookingsCalendar({
  entries,
  timeZone,
  month,
  onDayChosen,
  chosenDay,
}: BookingsCalendarProps): React.JSX.Element {
  const events = React.useMemo(
    () =>
      entries.map((entry) => ({
        id: entry.id,
        title: entry.title,
        start: entry.date,
        allDay: true,
        url: entry.href,
        className: `bookings-calendar-${entry.tone}`,
        ...TONE_COLOURS[entry.tone],
        extendedProps: { order: entry.order },
      })),
    [entries],
  );

  return (
    <div className="bookings-calendar">
      <FullCalendar
        // A new month is a new grid: the page address says which.
        key={month}
        plugins={[dayGridPlugin, classicThemePlugin]}
        locale={enAuLocale}
        timeZone={timeZone}
        initialView="dayGridMonth"
        initialDate={`${month}-01`}
        firstDay={1}
        headerToolbar={false}
        fixedWeekCount={false}
        dayHeaderFormat={{ weekday: "short" }}
        height="auto"
        eventDisplay="block"
        eventOrder="order"
        events={events}
        // Each day's number is FullCalendar's own link to the day, read out with its full date
        // and reached by Tab and Enter; it opens the page's day instead of a day view.
        navLinks
        navLinkHint="Open $0"
        navLinkDayClick={(date) => onDayChosen(todayInTimeZone(date, timeZone))}
        dayCellClass={(info) =>
          cn(
            info.isOther && "bookings-calendar-other-month",
            todayInTimeZone(info.date, timeZone) === chosenDay && "bookings-calendar-chosen-day",
          )
        }
        dayCellTopInnerClass={(info) => cn("bookings-calendar-day", info.isToday && "is-today")}
      />
    </div>
  );
}
