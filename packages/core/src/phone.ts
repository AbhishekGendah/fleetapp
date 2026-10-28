/** An Australian phone number, written the national way, has 10 digits at most. */
export const PHONE_MAXIMUM_DIGITS = 10;
/** "13 12 34" style business numbers are six digits. */
const SHORT_BUSINESS_NUMBER_DIGITS = 6;

const MOBILE_PREFIXES = ["04", "05"];
const LANDLINE_PREFIXES = ["02", "03", "07", "08"];
const BUSINESS_PREFIXES = ["1300", "1800"];
const COUNTRY_CODE = "61";

/** "+61 412…" is the same number as "0412…": keep the national form. */
function nationalDigits(input: string): string {
  const digits = input.replace(/\D/g, "");
  const isInternational = input.trim().startsWith("+") && digits.startsWith(COUNTRY_CODE);
  const national = isInternational ? `0${digits.slice(COUNTRY_CODE.length)}` : digits;
  return national.slice(0, PHONE_MAXIMUM_DIGITS);
}

function group(digits: string, sizes: readonly number[]): string {
  const parts: string[] = [];
  let start = 0;
  for (const size of sizes) {
    if (start >= digits.length) {
      break;
    }
    parts.push(digits.slice(start, start + size));
    start += size;
  }
  return parts.join(" ");
}

type PhoneKind = "mobile" | "landline" | "business" | "short_business" | "other";

function kindOf(digits: string): PhoneKind {
  if (MOBILE_PREFIXES.some((prefix) => digits.startsWith(prefix))) {
    return "mobile";
  }
  if (LANDLINE_PREFIXES.some((prefix) => digits.startsWith(prefix))) {
    return "landline";
  }
  if (BUSINESS_PREFIXES.some((prefix) => digits.startsWith(prefix))) {
    return "business";
  }
  // "13", then anything but "00": a six-digit number such as 13 12 34.
  if (digits.startsWith("13") && !digits.startsWith("1300")) {
    return "short_business";
  }
  return "other";
}

/**
 * Formats an Australian phone number as it is typed: "0412 345 678",
 * "(08) 9123 4567", "1300 123 456", "13 12 34". Extra digits are dropped, so
 * the box cannot hold more than a number can have.
 */
export function formatAustralianPhone(input: string): string {
  const typedDigits = input.replace(/\D/g, "");
  // Mid-way through typing "+61": keep the plus, or it could never be typed.
  if (input.trim().startsWith("+") && COUNTRY_CODE.startsWith(typedDigits)) {
    return `+${typedDigits}`;
  }
  const digits = nationalDigits(input);
  switch (kindOf(digits)) {
    case "mobile":
    case "business":
    case "other":
      return group(digits, [4, 3, 3]);
    case "short_business":
      return group(digits.slice(0, SHORT_BUSINESS_NUMBER_DIGITS), [2, 2, 2]);
    case "landline":
      return digits.length <= 2
        ? `(${digits}`
        : `(${digits.slice(0, 2)}) ${group(digits.slice(2), [4, 4])}`;
  }
}

/** Whether a number is complete and has the shape its prefix calls for. */
export function isValidAustralianPhone(input: string): boolean {
  const digits = nationalDigits(input);
  const kind = kindOf(digits);
  if (kind === "other") {
    return false;
  }
  const expectedLength =
    kind === "short_business" ? SHORT_BUSINESS_NUMBER_DIGITS : PHONE_MAXIMUM_DIGITS;
  return digits.length === expectedLength;
}
