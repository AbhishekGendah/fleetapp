import type { RentalStatus } from "@fleetapp/core";
import type { BookingTone } from "@fleetapp/ui/booking-tones";

/** The colour a rental shows in on the calendar and the timeline: its step. */
export const BOOKING_TONES: Readonly<Record<RentalStatus, BookingTone>> = {
  draft: "draft",
  booked: "booked",
  active: "active",
  returned: "finished",
  closed: "finished",
  cancelled: "finished",
};
