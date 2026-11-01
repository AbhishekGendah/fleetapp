"use client";

import { BookingsCalendar, type CalendarEntry } from "@fleetapp/ui/bookings-calendar";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { MONTH_PARAM, monthOf } from "./calendar-window";

/**
 * The calendar, loading each month's bookings as the Operator moves through
 * the months: the month goes in the page address, and the page loads it.
 */
export function CalendarView(props: {
  entries: readonly CalendarEntry[];
  timeZone: string;
  month: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <BookingsCalendar
      entries={props.entries}
      timeZone={props.timeZone}
      initialDate={`${props.month}-01`}
      onWindowChange={({ from, to }) => {
        // The middle of what is shown is always in the month the title names.
        const shownMonth = monthOf(new Date((from.getTime() + to.getTime()) / 2), props.timeZone);
        if (shownMonth === props.month) {
          return;
        }
        const next = new URLSearchParams(searchParams);
        next.set(MONTH_PARAM, shownMonth);
        router.replace(`${pathname}?${next.toString()}`, { scroll: false });
      }}
    />
  );
}
