/**
 * Australian driver licence numbers: digits in WA, QLD, NSW and VIC, letters
 * and digits in SA, TAS, NT and ACT, and never more than 10 characters.
 * Spaces and dashes people type in are dropped, letters are capitals.
 */
export const MAXIMUM_LICENCE_NUMBER_LENGTH = 10;

export function normaliseLicenceNumber(typed: string): string {
  return typed
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, MAXIMUM_LICENCE_NUMBER_LENGTH);
}
