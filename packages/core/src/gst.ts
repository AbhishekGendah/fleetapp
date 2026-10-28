/** GST began in Australia on this date; nobody was registered before it. */
export const GST_START_DATE = "2000-07-01";

export interface GstRegistration {
  isRegistered: boolean;
  /** ISO date (YYYY-MM-DD), or null. */
  registeredFrom: string | null;
}

export type GstRegistrationProblem =
  "missing_date" | "date_without_registration" | "before_gst" | null;

/**
 * A registered business must say from when, because charges from before
 * that date carry no GST. An unregistered one must not have a date, so the
 * two can never disagree.
 */
export function checkGstRegistration(registration: GstRegistration): GstRegistrationProblem {
  if (registration.isRegistered && !registration.registeredFrom) {
    return "missing_date";
  }
  if (!registration.isRegistered && registration.registeredFrom) {
    return "date_without_registration";
  }
  if (registration.registeredFrom && registration.registeredFrom < GST_START_DATE) {
    return "before_gst";
  }
  return null;
}
