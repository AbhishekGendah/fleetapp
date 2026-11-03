/** How a booking is coloured: the rental's step. */
export type BookingTone = "draft" | "booked" | "active" | "finished";

/** Each step's colour, from the brand's theme; white text on each meets WCAG AA contrast. */
export const BOOKING_TONE_COLOURS: Readonly<Record<BookingTone, string>> = {
  draft: "var(--color-muted-foreground)",
  booked: "var(--color-teal)",
  active: "var(--color-primary)",
  finished: "var(--color-muted-foreground)",
};
