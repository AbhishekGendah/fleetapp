"use client";

import { BookingsCalendar, type CalendarEntry } from "@fleetapp/ui/bookings-calendar";
import { useRouter } from "next/navigation";

import { calendarPath } from "../../../lib/paths";

/** The Month view's grid: each day's number opens that day, keeping the car chosen. */
export function CalendarView(props: {
  entries: readonly CalendarEntry[];
  timeZone: string;
  month: string;
  chosenDay: string | undefined;
  vehicleId: string | undefined;
}) {
  const router = useRouter();
  return (
    <BookingsCalendar
      entries={props.entries}
      timeZone={props.timeZone}
      month={props.month}
      chosenDay={props.chosenDay}
      onDayChosen={(day) => router.push(calendarPath({ day, vehicleId: props.vehicleId }))}
    />
  );
}
