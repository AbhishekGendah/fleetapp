/**
 * Admins are AGS staff, and AGS is in Perth. Operators see their own timezone
 * in their own app (rule 10); this is only for the admin site.
 */
const ADMIN_DISPLAY_TIMEZONE = "Australia/Perth";

const dateTimeFormat = new Intl.DateTimeFormat("en-AU", {
  timeZone: ADMIN_DISPLAY_TIMEZONE,
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatAdminDateTime(date: Date): string {
  return dateTimeFormat.format(date);
}
