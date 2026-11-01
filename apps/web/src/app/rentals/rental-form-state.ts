import type { FormResultLink } from "@fleetapp/ui/change-form-state";

/** What saving the New rental form came back with. A saved rental goes straight to its page. */
export type RentalFormState =
  | { status: "editing" }
  | { status: "failed"; formError: string; reasons: string[]; link?: FormResultLink };

/** Which button was pressed: book the car now, or keep it as a draft without holding the car. */
export const INTENT_FIELD = "intent";
export const BOOK_INTENT = "book";
export const DRAFT_INTENT = "draft";
