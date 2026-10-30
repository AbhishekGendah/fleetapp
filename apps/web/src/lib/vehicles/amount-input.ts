import { isCalendarDate, isPossibleGst, optionalDollars, REQUIRED_MESSAGE } from "@fleetapp/core";
import { z } from "zod";

/** The pieces every car paperwork and cost form shares: dates, and amounts with GST. */

const DATE_MESSAGE = "Enter a date.";
const GST_TOO_HIGH_MESSAGE = "GST cannot be more than a tenth of the GST-inclusive amount.";

export const requiredDate = z
  .string()
  .trim()
  .min(1, REQUIRED_MESSAGE)
  .refine(isCalendarDate, DATE_MESSAGE);

export const optionalDate = z
  .string()
  .trim()
  .refine((value) => value === "" || isCalendarDate(value), DATE_MESSAGE)
  .transform((value) => (value === "" ? null : value));

/** Blank GST means none: the amount did not include GST. */
export const gstDollars = optionalDollars.transform((cents) => cents ?? 0);

/**
 * GST is never more than the tenth inside its amount (rule 9). Returns the
 * check for a form whose amount is in `amountField` and GST in `gstCents`.
 */
type AmountAndGst<AmountField extends string> = Record<AmountField, number> & { gstCents: number };

export function refineGstWithin<AmountField extends string>(
  amountField: AmountField,
): (input: AmountAndGst<AmountField>, context: z.RefinementCtx) => void {
  return (input, context) => {
    if (!isPossibleGst(input[amountField], input.gstCents)) {
      context.addIssue({ code: "custom", path: ["gstCents"], message: GST_TOO_HIGH_MESSAGE });
    }
  };
}
