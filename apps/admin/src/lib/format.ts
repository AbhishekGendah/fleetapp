import { formatDateTimeInTimeZone } from "@fleetapp/core";

/**
 * Admins are AGS staff, and AGS is in Perth. Operators see their own timezone
 * in their own app (rule 10); this is only for the admin site.
 */
const ADMIN_DISPLAY_TIMEZONE = "Australia/Perth";

export function formatAdminDateTime(date: Date): string {
  return formatDateTimeInTimeZone(date, ADMIN_DISPLAY_TIMEZONE);
}
