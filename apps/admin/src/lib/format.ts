import { AUSTRALIAN_LOCALE, formatDateTimeInTimeZone } from "@fleetapp/core";

/**
 * Admins are AGS staff, and AGS is in Perth. Operators see their own timezone
 * in their own app (rule 10); this is only for the admin site.
 */
export const ADMIN_DISPLAY_TIMEZONE = "Australia/Perth";

/** A day on AGS's clock, e.g. "5 Nov 2026" (review A9-10). */
export function formatAdminDate(date: Date): string {
  return new Intl.DateTimeFormat(AUSTRALIAN_LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: ADMIN_DISPLAY_TIMEZONE,
  }).format(date);
}

export function formatAdminDateTime(date: Date): string {
  return formatDateTimeInTimeZone(date, ADMIN_DISPLAY_TIMEZONE);
}
