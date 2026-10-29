import { digitsOnly } from "./text";

export const AUSTRALIAN_STATE_CODES = [
  "NSW",
  "VIC",
  "QLD",
  "WA",
  "SA",
  "TAS",
  "ACT",
  "NT",
] as const;
export type AustralianStateCode = (typeof AUSTRALIAN_STATE_CODES)[number];

export function isAustralianStateCode(value: string): value is AustralianStateCode {
  return (AUSTRALIAN_STATE_CODES as readonly string[]).includes(value);
}

type PostcodeRange = readonly [from: number, to: number];

/**
 * Australia Post's ranges, by state. They overlap and have exceptions (parts
 * of the ACT sit in NSW ranges, Jervis Bay, Norfolk Island), so a mismatch
 * is only ever a warning, never a refusal.
 */
const POSTCODE_RANGES: Record<AustralianStateCode, readonly PostcodeRange[]> = {
  NSW: [
    [1000, 2599],
    [2619, 2899],
    [2921, 2999],
  ],
  ACT: [
    [200, 299],
    [2600, 2618],
    [2900, 2920],
  ],
  VIC: [
    [3000, 3999],
    [8000, 8999],
  ],
  QLD: [
    [4000, 4999],
    [9000, 9999],
  ],
  SA: [[5000, 5999]],
  WA: [
    [6000, 6797],
    [6800, 6999],
  ],
  TAS: [[7000, 7999]],
  NT: [[800, 999]],
};

export const POSTCODE_DIGIT_COUNT = 4;
export const POSTCODE_PATTERN = new RegExp(`^\\d{${POSTCODE_DIGIT_COUNT}}$`);

/** A postcode as it is typed: digits only, and no more than a postcode has. */
export function formatPostcode(input: string): string {
  return digitsOnly(input).slice(0, POSTCODE_DIGIT_COUNT);
}

/** False when the postcode does not look like one from that state. */
export function postcodeMatchesState(postcode: string, state: AustralianStateCode): boolean {
  if (!POSTCODE_PATTERN.test(postcode)) {
    return false;
  }
  const value = Number(postcode);
  return POSTCODE_RANGES[state].some(([from, to]) => value >= from && value <= to);
}
