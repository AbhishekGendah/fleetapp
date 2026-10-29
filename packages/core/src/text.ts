const NON_DIGITS = /\D/g;

/** Just the digits of what was typed: "(08) 9123-4567" becomes "0891234567". */
export function digitsOnly(input: string): string {
  return input.replace(NON_DIGITS, "");
}
