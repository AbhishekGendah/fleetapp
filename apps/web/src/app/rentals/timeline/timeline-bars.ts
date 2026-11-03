import {
  addDays,
  formatCalendarDate,
  formatDateTimeInTimeZone,
  utcToLocalDateTime,
  VEHICLE_STATUS_LABELS,
} from "@fleetapp/core";
import type { TimelineBar } from "@fleetapp/ui/fleet-timeline";

import { rentalPath } from "../../../lib/paths";
import { BOOKING_TONES } from "../../../lib/rentals/booking-tones";
import type { CalendarBooking } from "../../../lib/rentals/rental-queries";
import type { PastPossession } from "../../../lib/rentals/timeline-queries";
import type { VehicleSummary } from "../../../lib/vehicles/vehicle-queries";

/** DayPilot reads wall-clock moments with seconds. */
const SECONDS = ":00";
const MIDNIGHT = "T00:00:00";

/** What the bars are worked out against: the stretch's end and the Operator's clock (rule 10). */
export interface BarContext {
  to: Date;
  timeZone: string;
  today: string;
}

function wallClock(moment: Date, timeZone: string): string {
  return `${utcToLocalDateTime(moment, timeZone)}${SECONDS}`;
}

function spanText(from: Date, until: Date | null, timeZone: string): string {
  const end = until ? `to ${formatDateTimeInTimeZone(until, timeZone)}` : "ongoing";
  return `${formatDateTimeInTimeZone(from, timeZone)} ${end}`;
}

/** A booked or out rental's hold on its car: today and the future. */
export function holdBarOf(booking: CalendarBooking, context: BarContext): TimelineBar {
  return {
    id: `hold-${booking.rentalId}-${booking.vehicleId}`,
    rowId: booking.vehicleId,
    title: booking.renterFullName,
    when: spanText(booking.heldFrom, booking.heldUntil, context.timeZone),
    start: wallClock(booking.heldFrom, context.timeZone),
    // An ongoing rental runs on past the last day loaded.
    end: wallClock(booking.heldUntil ?? context.to, context.timeZone),
    href: rentalPath(booking.rentalId),
    tone: BOOKING_TONES[booking.status],
  };
}

/** A finished spell with a car (returned, or handed back in a swap): the past. */
export function pastBarOf(possession: PastPossession, context: BarContext): TimelineBar {
  return {
    id: `past-${possession.rentalId}-${possession.vehicleId}-${possession.startedAt.getTime()}`,
    rowId: possession.vehicleId,
    title: possession.renterFullName,
    when: spanText(possession.startedAt, possession.endedAt, context.timeZone),
    start: wallClock(possession.startedAt, context.timeZone),
    end: wallClock(possession.endedAt, context.timeZone),
    href: rentalPath(possession.rentalId),
    tone: "finished",
  };
}

/** A car in the workshop or off the road: striped from today to the day it is expected back. */
export function workshopBarOf(car: VehicleSummary, context: BarContext): TimelineBar | null {
  if (!car.statusReason || !car.statusExpectedBack || car.statusExpectedBack < context.today) {
    return null;
  }
  return {
    id: `workshop-${car.id}`,
    rowId: car.id,
    title: `${VEHICLE_STATUS_LABELS[car.status]}: ${car.statusReason}`,
    when: `expected back ${formatCalendarDate(car.statusExpectedBack)}`,
    start: `${context.today}${MIDNIGHT}`,
    // Shown through the day it is expected back.
    end: `${addDays(car.statusExpectedBack, 1)}${MIDNIGHT}`,
    tone: "workshop",
  };
}
