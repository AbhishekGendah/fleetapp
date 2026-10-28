import {
  AUSTRALIAN_STATE_CODES,
  checkGstRegistration,
  isAustralianTimezone,
  isValidAbn,
  normaliseAbn,
  POSTCODE_PATTERN,
} from "@fleetapp/core";
import { z } from "zod";

const MAXIMUM_TEXT_LENGTH = 200;
const PHONE_DIGITS_MINIMUM = 8;
const PHONE_DIGITS_MAXIMUM = 15;

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
    phone: optionalLine.refine((value) => {
      if (value === null) {
        return true;
      }
      const digits = value.replace(/\D/g, "");
      return (
        /^[\d\s()+-]+$/.test(value) &&
        digits.length >= PHONE_DIGITS_MINIMUM &&
        digits.length <= PHONE_DIGITS_MAXIMUM
      );
    }, "Enter a phone number, e.g. 08 9123 4567."),
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
