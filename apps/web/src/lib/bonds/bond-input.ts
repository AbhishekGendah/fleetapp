import {
  centsForEditing,
  MANUAL_PAYMENT_METHODS,
  optionalLine,
  REQUIRED_MESSAGE,
  requiredDollars,
  requiredLine,
} from "@fleetapp/core";
import { z } from "zod";

import { requiredDate } from "../vehicles/amount-input";

const ABOVE_ZERO_MESSAGE = "Enter more than $0.";
const FUTURE_MESSAGE = "This can't be a day still to come.";

/**
 * Bond received by hand: how much, how (bank transfer or cash), the day,
 * and the transfer's reference or receipt number in capitals (rule 31).
 * `today` is the Operator's, so a payment cannot be dated in the future.
 */
function buildBondReceivedSchema(today: string) {
  return z.object({
    amountCents: requiredDollars.refine((cents) => cents > 0, ABOVE_ZERO_MESSAGE),
    method: z.enum(MANUAL_PAYMENT_METHODS, REQUIRED_MESSAGE),
    reference: optionalLine.transform((value) => value?.toUpperCase() ?? null),
    occurredOn: requiredDate.refine((day) => day <= today, FUTURE_MESSAGE),
  });
}

type BondReceivedSchema = ReturnType<typeof buildBondReceivedSchema>;

export function bondReceivedInputSchema(today: string): BondReceivedSchema {
  return buildBondReceivedSchema(today);
}

export type BondReceivedInput = z.infer<BondReceivedSchema>;
export const BOND_RECEIVED_FIELDS = ["amountCents", "method", "reference", "occurredOn"] as const;
export type BondReceivedField = (typeof BOND_RECEIVED_FIELDS)[number];
export const REQUIRED_BOND_RECEIVED_FIELDS: ReadonlySet<BondReceivedField> = new Set([
  "amountCents",
  "method",
  "occurredOn",
]);

/** What the form starts with: the rest of the bond, by bank transfer, today. */
export function bondReceivedStart(
  owingCents: number,
  today: string,
): Record<BondReceivedField, string> {
  return {
    amountCents: owingCents > 0 ? centsForEditing(owingCents) : "",
    method: "bank_transfer",
    reference: "",
    occurredOn: today,
  };
}

/** Why an entry is corrected; kept with the bond, never in the Log. */
export const bondReversalInputSchema = z.object({ note: requiredLine });
export type BondReversalInput = z.infer<typeof bondReversalInputSchema>;
export const BOND_REVERSAL_FIELDS = ["note"] as const;
