"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import enAuLocale from "@fullcalendar/react/locales/en-au";
import listPlugin from "@fullcalendar/react/list";
import classicThemePlugin from "@fullcalendar/react/themes/classic";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import * as React from "react";

import "./bookings-calendar.css";

import { isPhoneWidth } from "../lib/phone-width";
import { BOOKING_TONE_COLOURS, type BookingTone } from "./booking-tones";

export type { BookingTone } from "./booking-tones";

export interface CalendarEntry {
  id: string;
  /** e.g. "1ABC234 · Sam Example". */
  title: string;
  /**
   * ISO moments. An ongoing rental is given the end of the window it is
   * shown in. A single moment, such as a pickup, has no end.
   */
  start: string;
  end?: string;
  /** The rental's page. */
  href: string;
  tone: BookingTone;
}

export interface BookingsCalendarProps {
  entries: readonly CalendarEntry[];
  /** The Operator's timezone: times show on their clock (rule 10). */
  timeZone: string;
  /** The day the calendar opens on, "2026-12-01". */
  initialDate: string;
  /** Told when the person moves to another month or view, to load its bookings. */
  onWindowChange?: (window: { from: Date; to: Date }) => void;
}

/** A phone shows the list; the month grid is too narrow to read there (rule 24). */
const MONTH_VIEW = "dayGridMonth";
const LIST_VIEW = "listMonth";

/**
 * Bookings on FullCalendar's free (MIT) month and list views: a month
 * grid on a computer, a list on a phone, either one a tap away. Each booking
 * opens its rental. Times are on the Operator's clock.
 */
export function BookingsCalendar({
  entries,
  timeZone,
  initialDate,
  onWindowChange,
}: BookingsCalendarProps): React.JSX.Element {
  const events = React.useMemo(
    () =>
      entries.map((entry) => ({
        id: entry.id,
        title: entry.title,
        start: entry.start,
        end: entry.end,
        url: entry.href,
        color: BOOKING_TONE_COLOURS[entry.tone],
      })),
    [entries],
  );

  return (
    <div className="bookings-calendar">
      <FullCalendar
        plugins={[dayGridPlugin, listPlugin, classicThemePlugin]}
        locale={enAuLocale}
        timeZone={timeZone}
        initialView={isPhoneWidth() ? LIST_VIEW : MONTH_VIEW}
        initialDate={initialDate}
        headerToolbar={{
          start: "prev,next today",
          center: "title",
          end: `${MONTH_VIEW},${LIST_VIEW}`,
        }}
        todayText="Today"
        // The button reads "Today"; its spoken name must say the same (WCAG 2.5.3).
        todayHint="Today"
        monthText="Month"
        noEventsText="No bookings in this month."
        height="auto"
        // A solid bar, not a dot: easier to read and to tap.
        eventDisplay="block"
        eventTimeFormat={{ hour: "numeric", minute: "2-digit" }}
        events={events}
        datesSet={(info) => onWindowChange?.({ from: info.start, to: info.end })}
      />
    </div>
  );
}
