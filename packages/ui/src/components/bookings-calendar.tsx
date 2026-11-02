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

/** How a booking is coloured: the rental's step. */
export type BookingTone = "draft" | "booked" | "active" | "finished";

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

/** Each step's colour, from the brand's theme; white text on each meets WCAG AA contrast. */
const TONE_COLOURS: Readonly<Record<BookingTone, string>> = {
  draft: "var(--color-muted-foreground)",
  booked: "var(--color-teal)",
  active: "var(--color-primary)",
  finished: "var(--color-muted-foreground)",
};

/** A phone shows the list; the month grid is too narrow to read there (rule 24). */
const PHONE_QUERY = "(max-width: 639px)";
const MONTH_VIEW = "dayGridMonth";
const LIST_VIEW = "listMonth";

function isPhoneWidth(): boolean {
  return typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches;
}

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
        color: TONE_COLOURS[entry.tone],
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
