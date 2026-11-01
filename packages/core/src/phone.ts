import { AsYouType, isValidPhoneNumber } from "libphonenumber-js";

import { digitsOnly } from "./text";

/** An Australian phone number, written the national way, has 10 digits at most. */
export const PHONE_MAXIMUM_DIGITS = 10;
/** "13 12 34" style business numbers are six digits. */
const SHORT_BUSINESS_NUMBER_DIGITS = 6;
const SHORT_BUSINESS_GROUP_DIGITS = 2;
const AREA_CODE_DIGITS = 2;
const COUNTRY = "AU";
const COUNTRY_CODE = "61";

/** "+61 412…" is the same number as "0412…": keep the national form. */
function nationalDigits(input: string): string {
  const digits = digitsOnly(input);
  const isInternational = input.trim().startsWith("+") && digits.startsWith(COUNTRY_CODE);
  const national = isInternational ? `0${digits.slice(COUNTRY_CODE.length)}` : digits;
  return national.slice(0, PHONE_MAXIMUM_DIGITS);
}

/** "13", then anything but "00": a six-digit number such as 13 12 34. */
function isShortBusinessNumber(digits: string): boolean {
  return digits.startsWith("13") && !digits.startsWith("1300");
}

/** 13 12 34: Google's rules leave these unspaced, but this is how Australians write them. */
function formatShortBusinessNumber(digits: string): string {
  const groups = digits
    .slice(0, SHORT_BUSINESS_NUMBER_DIGITS)
    .match(new RegExp(`.{1,${SHORT_BUSINESS_GROUP_DIGITS}}`, "g"));
  return (groups ?? []).join(" ");
}

/**
 * Formats an Australian phone number as it is typed, by Google's phone number
 * rules (libphonenumber): "0412 345 678", "(08) 9123 4567", "1300 123 456",
 * "13 12 34". Extra digits are dropped, so the box cannot hold more than a
 * number can have.
 */
export function formatAustralianPhone(input: string): string {
  const typedDigits = digitsOnly(input);
  // Mid-way through typing "+61": keep the plus, or it could never be typed.
  if (input.trim().startsWith("+") && COUNTRY_CODE.startsWith(typedDigits)) {
    return `+${typedDigits}`;
  }
  const digits = nationalDigits(input);
  if (isShortBusinessNumber(digits)) {
    return formatShortBusinessNumber(digits);
  }
  const formatted = new AsYouType(COUNTRY).input(digits);
  // "(08)" while only the area code is typed would put back the bracket each
  // time Backspace took it away, so it closes once the next digit comes.
  return digits.length === AREA_CODE_DIGITS ? formatted.replace(/\)$/, "") : formatted;
}

/** Whether a number is complete and real by Google's phone number rules for Australia. */
export function isValidAustralianPhone(input: string): boolean {
  return isValidPhoneNumber(nationalDigits(input), COUNTRY);
}
