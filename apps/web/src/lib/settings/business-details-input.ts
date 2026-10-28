import {
  AUSTRALIAN_STATE_CODES,
  checkGstRegistration,
  formatAustralianPhone,
  isAustralianTimezone,
  isValidAustralianPhone,
  isValidAbn,
  normaliseAbn,
  POSTCODE_PATTERN,
} from "@fleetapp/core";
import { z } from "zod";

export const MAXIMUM_TEXT_LENGTH = 200;

/** Business details go on contracts and in email subjects: one line each. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

const singleLine = z
  .string()
  .trim()
  .max(MAXIMUM_TEXT_LENGTH, `At most ${MAXIMUM_TEXT_LENGTH} characters.`)
  .refine((value) => !CONTROL_CHARACTERS.test(value), "Must be on one line.");

/** Blank means "not filled in yet": the setup checklist shows what is missing. */
const optionalLine = singleLine.transform((value) => (value === "" ? null : value));

const GST_PROBLEM_MESSAGES = {
  missing_date: "Enter the date you registered for GST.",
  date_without_registration: "Only enter a GST date if you are registered.",
  before_gst: "GST started on 1 July 2000. Check the date.",
} as const;

/**
 * Business details as submitted from the Settings form. Every field but the
 * legal name may be left blank and filled in later; anything filled in must
 * be right.
 */
export const businessDetailsInputSchema = z
  .object({
    legalName: singleLine.min(1, "Required."),
    tradingName: optionalLine,
    abn: optionalLine
      .refine(
        (value) => value === null || isValidAbn(value),
        "That is not a valid ABN. Check the 11 digits.",
      )
      .transform((value) => (value === null ? null : normaliseAbn(value))),
    gstRegistered: z.boolean(),
    gstRegisteredFrom: optionalLine.refine(
      (value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value),
      "Enter a date.",
    ),
    addressLine1: optionalLine,
    addressLine2: optionalLine,
    suburb: optionalLine,
    state: z.enum(AUSTRALIAN_STATE_CODES).nullable(),
    postcode: optionalLine.refine(
      (value) => value === null || POSTCODE_PATTERN.test(value),
      "A postcode is 4 digits.",
    ),
    phone: optionalLine
      .refine(
        (value) => value === null || isValidAustralianPhone(value),
        "Enter a full Australian number, e.g. 0412 345 678 or (08) 9123 4567.",
      )
      .transform((value) => (value === null ? null : formatAustralianPhone(value))),
    email: optionalLine.refine(
      (value) => value === null || z.email().safeParse(value).success,
      "Enter a valid email address.",
    ),
    timezone: z.string().refine(isAustralianTimezone, "Choose a timezone."),
  })
  .superRefine((input, context) => {
    const problem = checkGstRegistration({
      isRegistered: input.gstRegistered,
      registeredFrom: input.gstRegisteredFrom,
    });
    if (problem) {
      context.addIssue({
        code: "custom",
        path: ["gstRegisteredFrom"],
        message: GST_PROBLEM_MESSAGES[problem],
      });
    }
  });

export type BusinessDetailsInput = z.infer<typeof businessDetailsInputSchema>;

/** What the form's boxes hold: every field as text, plus the GST tick. */
export type BusinessDetailsFormValues = Record<
  Exclude<keyof BusinessDetailsInput, "gstRegistered">,
  string
>;

/**
 * Checks the form exactly as the server will, so the browser can show the
 * same messages while you type. A GST date left in the box after unticking
 * GST is ignored, not refused: it is hidden, so it cannot be fixed.
 */
export function parseBusinessDetailsForm(
  values: BusinessDetailsFormValues,
  isGstRegistered: boolean,
): z.ZodSafeParseResult<BusinessDetailsInput> {
  return businessDetailsInputSchema.safeParse({
    ...values,
    state: values.state || null,
    gstRegistered: isGstRegistered,
    gstRegisteredFrom: isGstRegistered ? values.gstRegisteredFrom : "",
  });
}
