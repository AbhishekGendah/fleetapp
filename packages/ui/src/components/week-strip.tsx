import type * as React from "react";

import { cn } from "../lib/utils";

export interface WeekStripDay {
  /** "2026-11-07": also the key. */
  date: string;
  /** "Sat". */
  weekday: string;
  /** "7". */
  dayNumber: string;
  /** Where the day opens. */
  href: string;
  /** Something happens that day: shown as a dot, and read out. */
  hasItems: boolean;
  isToday: boolean;
  /** The day asked for, when it is not today: ringed. */
  isChosen?: boolean;
}

/**
 * A week's seven days in a row for a phone (6 Nov 2026 look), each a link
 * to that day with a dot when something happens on it. Today is filled
 * navy and marked as the current date for screen readers; a day asked for
 * is ringed. Each day is at least 44px wide on a 375px screen (rule 24).
 */
export function WeekStrip({
  days,
  label,
  itemsWord = "bookings",
}: {
  days: readonly WeekStripDay[];
  /** Read out for the strip, e.g. "Days this week". */
  label: string;
  /** What the dot stands for, read out after the day: "Sat 7, has bookings". */
  itemsWord?: string;
}): React.JSX.Element {
  return (
    <nav aria-label={label} className="grid grid-cols-7 gap-1">
      {days.map((day) => (
        <a
          key={day.date}
          href={day.href}
          aria-current={day.isToday ? "date" : day.isChosen ? "true" : undefined}
          className={cn(
            "focus-visible:ring-ring flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-xl shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
            day.isToday ? "bg-primary text-primary-foreground" : "bg-card text-primary",
            day.isChosen && !day.isToday && "ring-primary ring-2",
          )}
        >
          <span className="text-xs font-bold">{day.weekday}</span>
          <span className="text-lg leading-none font-extrabold">{day.dayNumber}</span>
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 rounded-full",
              day.hasItems && (day.isToday ? "bg-primary-foreground" : "bg-teal"),
            )}
          />
          {day.hasItems ? <span className="sr-only">, has {itemsWord}</span> : null}
        </a>
      ))}
    </nav>
  );
}
