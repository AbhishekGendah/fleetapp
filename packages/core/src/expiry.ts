import { addDays } from "./calendar-dates";

/**
 * Whether something with an expiry date (rego, insurance, later licences)
 * needs attention. It is valid through its expiry date and expired the day
 * after.
 */
export type ExpiryStatus = "none" | "current" | "due_soon" | "expired";

/** How many days ahead "due soon" starts, unless the Operator changes it. */
export const DEFAULT_EXPIRY_WARNING_DAYS = 30;
export const MINIMUM_EXPIRY_WARNING_DAYS = 1;
export const MAXIMUM_EXPIRY_WARNING_DAYS = 90;

export function expiryStatus(
  expiresOn: string | null,
  today: string,
  warningDays: number,
): ExpiryStatus {
  if (!expiresOn) {
    return "none";
  }
  if (expiresOn < today) {
    return "expired";
  }
  return expiresOn <= addDays(today, warningDays) ? "due_soon" : "current";
}
