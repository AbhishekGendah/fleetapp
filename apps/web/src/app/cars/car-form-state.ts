/**
 * What saving the car form came back with. The form keeps what was typed, so
 * a refusal carries only what to show. A saved car goes straight to its page.
 */
export type CarFormState =
  | { status: "editing" }
  | { status: "failed"; formError: string }
  | { status: "duplicate"; field: "rego" | "vin"; existingCarHref: string | null };
