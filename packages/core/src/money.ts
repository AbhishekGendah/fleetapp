import { z } from "zod";

import { AUSTRALIAN_LOCALE } from "./locale";
import { groupThousands } from "./text";

/**
 * Money is whole cents of AUD, never fractions of a dollar held as floats
 * (rule 9). People type dollars; these turn what they type into cents and
 * back, the same way in the browser and on the server.
 */

const CENTS_PER_DOLLAR = 100;
/** GST is 10%, so it is one eleventh of a price that includes it. */
const GST_FRACTION_OF_INCLUSIVE_PRICE = 11;
/** Far above any car or bill an Operator records (and inside a database integer): catches an extra digit. */
export const MAXIMUM_AMOUNT_CENTS = 10_000_000_00;

/**
 * "$1,234.56", "1234.5", "1,234" or " 12 "; never negative, at most 2 decimal
 * places. A trailing "." is fine: it is what a box shows halfway through typing.
 */
const DOLLARS_PATTERN = /^\$?\s*(\d{1,3}(,\d{3})+|\d+)(\.\d{0,2})?$/;
/** Enough for any amount up to the maximum, so a box cannot fill with digits. */
const MAXIMUM_WHOLE_DOLLAR_DIGITS = 9;
const DECIMAL_PLACES = 2;

/** Cents from typed dollars, or null if it is not an amount. */
export function parseDollars(typed: string): number | null {
  const trimmed = typed.trim();
  if (!DOLLARS_PATTERN.test(trimmed)) {
    return null;
  }
  const [whole = "0", fraction = ""] = trimmed.replace(/[$,\s]/g, "").split(".");
  return Number(whole) * CENTS_PER_DOLLAR + Number(fraction.padEnd(2, "0"));
}

/** "$1,234.56": how an amount is shown everywhere. */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat(AUSTRALIAN_LOCALE, { style: "currency", currency: "AUD" }).format(
    cents / CENTS_PER_DOLLAR,
  );
}

/** "$1,234.56": an amount as it goes back into a box to be edited. */
export function centsForEditing(cents: number): string {
  return formatDollarsAsTyped((cents / CENTS_PER_DOLLAR).toFixed(DECIMAL_PLACES));
}

/**
 * What a dollar box shows as it is typed: "$" in front, a comma every three
 * digits, and at most two digits after the point, e.g. "1234.5" as
 * "$1,234.5". Anything else typed is dropped.
 */
export function formatDollarsAsTyped(raw: string): string {
  const kept = raw.replace(/[^\d.]/g, "");
  if (kept === "") {
    return "";
  }
  const [wholeTyped = "", ...rest] = kept.split(".");
  const hasPoint = rest.length > 0;
  const whole = wholeTyped.replace(/^0+(?=\d)/, "").slice(0, MAXIMUM_WHOLE_DOLLAR_DIGITS);
  const cents = rest.join("").slice(0, DECIMAL_PLACES);
  return `$${groupThousands(whole || "0")}${hasPoint ? `.${cents}` : ""}`;
}

/** The GST inside a price that includes it, to the nearest cent. */
export function gstIncludedIn(totalCents: number): number {
  return Math.round(totalCents / GST_FRACTION_OF_INCLUSIVE_PRICE);
}

/**
 * GST may be less than the full tenth (a bill can mix GST-free items, like
 * rego), but never more, and never negative.
 */
export function isPossibleGst(totalCents: number, gstCents: number): boolean {
  return gstCents >= 0 && gstCents <= gstIncludedIn(totalCents);
}

export const NOT_AN_AMOUNT_MESSAGE = "Enter an amount in dollars, e.g. 1,234.56.";

/** A dollar amount typed in a form box, as cents. */
export const requiredDollars = z
  .string()
  .trim()
  .min(1, "Required.")
  .transform((typed, context) => {
    const cents = parseDollars(typed);
    if (cents === null || cents > MAXIMUM_AMOUNT_CENTS) {
      context.addIssue({ code: "custom", message: NOT_AN_AMOUNT_MESSAGE });
      return z.NEVER;
    }
    return cents;
  });

/** As `requiredDollars`, but blank is allowed and becomes null. */
export const optionalDollars = z
  .string()
  .trim()
  .transform((typed) => (typed === "" ? null : typed))
  .pipe(requiredDollars.nullable());
