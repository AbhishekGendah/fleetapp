import {
  AUSTRALIAN_STATE_CODES,
  checkGstRegistration,
  formatAustralianPhone,
  isAustralianTimezone,
  isValidAustralianPhone,
  isValidAbn,
  normaliseAbn,
  optionalLine,
  POSTCODE_PATTERN,
  requiredEmail,
  REQUIRED_MESSAGE,
  requiredLine,
} from "@fleetapp/core";
import { z } from "zod";

const GST_PROBLEM_MESSAGES = {
  missing_date: "Enter the date you registered for GST.",
  date_without_registration: "Only enter a GST date if you are registered.",
  before_gst: "GST started on 1 July 2000. Check the date.",
} as const;

/**
 * Business details as submitted from the Settings form. Everything that goes
 * on a contract or a tax invoice is required: legal name, ABN, address,
 * phone and email. A trading name, a second address line and (when not
 * registered) a GST date may be left out.
 */
export const businessDetailsInputSchema = z
  .object({
    legalName: requiredLine,
    tradingName: optionalLine,
    abn: requiredLine
      .refine(isValidAbn, "That is not a valid ABN. Check the 11 digits.")
      .transform(normaliseAbn),
    gstRegistered: z.boolean(),
    gstRegisteredFrom: optionalLine.refine(
      (value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value),
      "Enter a date.",
    ),
    addressLine1: requiredLine,
    addressLine2: optionalLine,
    suburb: requiredLine,
    state: z.enum(AUSTRALIAN_STATE_CODES, REQUIRED_MESSAGE),
    postcode: requiredLine.regex(POSTCODE_PATTERN, "A postcode is 4 digits."),
    phone: requiredLine
      .refine(
        isValidAustralianPhone,
        "Enter a full Australian number, e.g. 0412 345 678 or (08) 9123 4567.",
      )
      .transform(formatAustralianPhone),
    email: requiredEmail,
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
