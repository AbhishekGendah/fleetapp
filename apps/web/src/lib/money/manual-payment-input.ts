import {
  centsForEditing,
  MANUAL_PAYMENT_METHODS,
  optionalLine,
  REQUIRED_MESSAGE,
  requiredDollars,
} from "@fleetapp/core";
import { z } from "zod";

import { requiredDate } from "../vehicles/amount-input";

const ABOVE_ZERO_MESSAGE = "Enter more than $0.";
const FUTURE_MESSAGE = "This can't be a day still to come.";

/**
 * Money received by hand (a bond, a rent payment): how much, how (bank
 * transfer or cash), the day, and the transfer's reference or receipt
 * number in capitals (rule 31). `today` is the Operator's, so it cannot be
 * dated in the future.
 */
function buildManualPaymentSchema(today: string) {
  return z.object({
    amountCents: requiredDollars.refine((cents) => cents > 0, ABOVE_ZERO_MESSAGE),
    method: z.enum(MANUAL_PAYMENT_METHODS, REQUIRED_MESSAGE),
    reference: optionalLine.transform((value) => value?.toUpperCase() ?? null),
    occurredOn: requiredDate.refine((day) => day <= today, FUTURE_MESSAGE),
  });
}

type ManualPaymentSchema = ReturnType<typeof buildManualPaymentSchema>;

export function manualPaymentInputSchema(today: string): ManualPaymentSchema {
  return buildManualPaymentSchema(today);
}

export type ManualPaymentInput = z.infer<ManualPaymentSchema>;
export const MANUAL_PAYMENT_FIELDS = ["amountCents", "method", "reference", "occurredOn"] as const;
export type ManualPaymentField = (typeof MANUAL_PAYMENT_FIELDS)[number];
export const REQUIRED_MANUAL_PAYMENT_FIELDS: ReadonlySet<ManualPaymentField> = new Set([
  "amountCents",
  "method",
  "occurredOn",
]);

/** What the form starts with: the amount suggested (if any), by bank transfer, today. */
export function manualPaymentStart(
  suggestedCents: number,
  today: string,
): Record<ManualPaymentField, string> {
  return {
    amountCents: suggestedCents > 0 ? centsForEditing(suggestedCents) : "",
    method: "bank_transfer",
    reference: "",
    occurredOn: today,
  };
}
