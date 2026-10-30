const NON_DIGITS = /\D/g;

/** Just the digits of what was typed: "(08) 9123-4567" becomes "0891234567". */
export function digitsOnly(input: string): string {
  return input.replace(NON_DIGITS, "");
}

/** "1234567" as "1,234,567". */
export function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** What a whole-number box shows as it is typed, e.g. "48210" as "48,210". */
export function formatWholeNumberAsTyped(raw: string, maximumDigits: number): string {
  return groupThousands(
    digitsOnly(raw)
      .replace(/^0+(?=\d)/, "")
      .slice(0, maximumDigits),
  );
}
