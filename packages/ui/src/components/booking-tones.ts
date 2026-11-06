/** How a booking is coloured: the rental's step. */
export type BookingTone = "draft" | "booked" | "active" | "finished";

export interface ToneColours {
  background: string;
  text: string;
}

/**
 * Each step's colours, from the brand's theme (6 Nov 2026 look): out navy,
 * booked light blue, the rest grey. They differ in lightness, not only in
 * colour (rule 34), and each text colour meets WCAG AA contrast on its own.
 */
export const BOOKING_TONE_COLOURS: Readonly<Record<BookingTone, ToneColours>> = {
  draft: { background: "var(--color-muted)", text: "var(--color-muted-foreground)" },
  booked: { background: "var(--color-booked-soft)", text: "var(--color-booked)" },
  active: { background: "var(--color-primary)", text: "var(--color-primary-foreground)" },
  finished: { background: "var(--color-muted)", text: "var(--color-muted-foreground)" },
};

/** Time in the workshop or off the road: amber, as the dashboard's workshop labels. */
export const WORKSHOP_COLOURS: ToneColours = {
  background: "var(--color-attention-soft)",
  text: "var(--color-attention)",
};
