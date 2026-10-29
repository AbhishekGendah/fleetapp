import { digitsOnly } from "./text";

/** An ABN is always 11 digits. Shown grouped 2-3-3-3, e.g. "51 824 753 556". */
export const ABN_DIGIT_COUNT = 11;

/** The ATO's weighting for each of the 11 digits. */
const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19] as const;
const ABN_MODULUS = 89;

/** ABNs are written with spaces between the groups; they are dropped. */
export function normaliseAbn(input: string): string {
  return input.replace(/\s+/g, "");
}

/**
 * Whether an ABN passes the ATO's own check: subtract 1 from the first
 * digit, weight each digit, and the total must divide by 89. Catches almost
 * every typo; it cannot tell whether the ABN belongs to this business.
 */
export function isValidAbn(input: string): boolean {
  const abn = normaliseAbn(input);
  if (!new RegExp(`^\\d{${ABN_DIGIT_COUNT}}$`).test(abn)) {
    return false;
  }
  const digits = [...abn].map(Number);
  digits[0] = (digits[0] ?? 0) - 1;
  const total = digits.reduce((sum, digit, index) => sum + digit * (ABN_WEIGHTS[index] ?? 0), 0);
  return total % ABN_MODULUS === 0;
}

/** Where the spaces go in an ABN: after the 2nd, 5th and 8th digits. */
const ABN_GROUP_ENDS = [2, 5, 8] as const;

/**
 * An ABN grouped the usual way, "51 824 753 556". Works on a partly typed
 * one too, so the box can group it as it is typed; anything that is not a
 * digit, and anything past the 11th digit, is dropped.
 */
export function formatAbn(input: string): string {
  const digits = digitsOnly(input).slice(0, ABN_DIGIT_COUNT);
  return [...digits]
    .map((digit, index) => (ABN_GROUP_ENDS.includes(index as 2 | 5 | 8) ? ` ${digit}` : digit))
    .join("");
}
