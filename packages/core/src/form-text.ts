import { z } from "zod";

import { isValidAbn, normaliseAbn } from "./abn";
import { formatAustralianPhone, isValidAustralianPhone } from "./phone";

export const MAXIMUM_LINE_LENGTH = 200;
export const REQUIRED_MESSAGE = "Required.";
export const INVALID_EMAIL_MESSAGE = "Enter a valid email address.";

/**
 * Names and addresses end up on contracts and in email subject lines, where a
 * line break would let someone add headers of their own. Refused here rather
 * than escaped later.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** One line of text from a form, trimmed. May be blank. */
export const singleLineText = z
  .string()
  .trim()
  .max(MAXIMUM_LINE_LENGTH, `At most ${MAXIMUM_LINE_LENGTH} characters.`)
  .refine((value) => !CONTROL_CHARACTERS.test(value), "Must be on one line.");

export const MAXIMUM_NOTE_LENGTH = 2000;
/** Control characters other than line breaks and tabs, which a note may hold. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const NON_TEXT_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Several lines of text, e.g. a note: trimmed, line breaks kept, must be filled in. */
export const requiredText = z
  .string()
  .trim()
  .min(1, REQUIRED_MESSAGE)
  .max(MAXIMUM_NOTE_LENGTH, `At most ${MAXIMUM_NOTE_LENGTH} characters.`)
  .refine((value) => !NON_TEXT_CHARACTERS.test(value), "Remove the unusual characters.");

/** As `requiredText`, but blank is allowed and becomes null. */
export const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value))
  .pipe(requiredText.nullable());

/** One line of text that must be filled in. */
export const requiredLine = singleLineText.min(1, REQUIRED_MESSAGE);

/** Blank becomes null: for details a business may not have. */
export const optionalLine = singleLineText.transform((value) => (value === "" ? null : value));

/** Lower-cased, as the login system compares addresses that way. */
export const requiredEmail = requiredLine.toLowerCase().pipe(z.email(INVALID_EMAIL_MESSAGE));

export const INVALID_PHONE_MESSAGE =
  "Enter a full Australian number, e.g. 0412 345 678 or (08) 9123 4567.";

export const INVALID_ABN_MESSAGE = "That is not a valid ABN. Check the 11 digits.";

/**
 * An ABN that passes the ATO's checksum, typed with or without spaces and
 * kept as its 11 digits (rule 31): the Operator's own on Settings, and a
 * business Renter's.
 */
export const requiredAbn = requiredLine
  .refine(isValidAbn, INVALID_ABN_MESSAGE)
  .transform(normaliseAbn);

/** An Australian phone number, saved in its tidy written form. */
export const requiredPhone = requiredLine
  .refine(isValidAustralianPhone, INVALID_PHONE_MESSAGE)
  .transform(formatAustralianPhone);

/** As `requiredPhone`, but blank is allowed and becomes null. */
export const optionalPhone = singleLineText
  .transform((value) => (value === "" ? null : value))
  .pipe(requiredPhone.nullable());

/**
 * The named text fields of a submitted form, blank where missing. Only these:
 * never anything else Next adds to the form.
 */
export function formTextValues<const Name extends string>(
  formData: FormData,
  names: readonly Name[],
): Record<Name, string> {
  return Object.fromEntries(
    names.map((name) => {
      const value = formData.get(name);
      return [name, typeof value === "string" ? value : ""];
    }),
  ) as Record<Name, string>;
}

/** A blank form: every named box empty. */
export function emptyForm<const Name extends string>(names: readonly Name[]): Record<Name, string> {
  return Object.fromEntries(names.map((name) => [name, ""])) as Record<Name, string>;
}

/**
 * A dropdown left on its "Choose…" option sends "", which a schema should
 * treat as missing, not as a choice. These become null.
 */
export function blankAsMissing<Values extends Record<string, string>>(
  values: Values,
  names: readonly (keyof Values)[],
): Record<string, string | null> {
  return {
    ...values,
    ...Object.fromEntries(names.map((name) => [name, values[name] || null])),
  };
}

/**
 * Each box's messages from a form check, as the shared form helper shows
 * them: nothing when the form is fine.
 */
export function fieldErrorsOf<Output>(
  result: z.ZodSafeParseResult<Output>,
): Record<string, string[] | undefined> {
  return result.success ? {} : z.flattenError(result.error).fieldErrors;
}

export const INVALID_WEB_ADDRESS_MESSAGE =
  "Enter the full web address, starting https://, e.g. https://example.com.au/privacy.";

const SECURE_WEB_ADDRESS = z.url({ protocol: /^https$/, hostname: z.regexes.domain });

/**
 * A web page the business gives, e.g. its privacy policy: blank becomes null.
 * Only https, and only a real domain, so a Renter's link can't be turned into
 * a script or sent to a bare internet address.
 */
export const optionalWebAddress = optionalLine.refine(
  (value) => value === null || SECURE_WEB_ADDRESS.safeParse(value).success,
  INVALID_WEB_ADDRESS_MESSAGE,
);
