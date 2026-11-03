import { formatDateTimeInTimeZone, utcToLocalDateTime } from "@fleetapp/core";
import type { TimelineBar } from "@fleetapp/ui/fleet-timeline";

import { rentalPath } from "../../../lib/paths";
import { BOOKING_TONES } from "../../../lib/rentals/booking-tones";
import type { CalendarBooking } from "../../../lib/rentals/rental-queries";

/** DayPilot reads wall-clock moments with seconds. */
const SECONDS = ":00";

function wallClock(moment: Date, timeZone: string): string {
  return `${utcToLocalDateTime(moment, timeZone)}${SECONDS}`;
}

/** One car's hold as a bar on its row, on the Operator's clock (rule 10). */
export function timelineBarOf(
  booking: CalendarBooking,
  window: { to: Date; timeZone: string },
): TimelineBar {
  const { timeZone } = window;
  const until = booking.heldUntil
    ? `to ${formatDateTimeInTimeZone(booking.heldUntil, timeZone)}`
    : "ongoing";
  return {
    id: `${booking.rentalId}-${booking.vehicleId}`,
    rowId: booking.vehicleId,
    title: booking.renterFullName,
    when: `${formatDateTimeInTimeZone(booking.heldFrom, timeZone)} ${until}`,
    start: wallClock(booking.heldFrom, timeZone),
    // An ongoing rental runs on past the last day shown.
    end: wallClock(booking.heldUntil ?? window.to, timeZone),
    href: rentalPath(booking.rentalId),
    tone: BOOKING_TONES[booking.status],
  };
}
