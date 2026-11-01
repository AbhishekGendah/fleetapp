import type { ChangeFormState } from "@fleetapp/ui/change-form-state";

/** A save, or a question first: lowering how long scans are kept deletes some tonight. */
export type NumberSettingState =
  ChangeFormState | { status: "confirm"; message: string; amount: string };

/** The form field that carries "yes, I meant it" for exactly this amount. */
export const CONFIRMED_AMOUNT_FIELD = "confirmedAmount";
