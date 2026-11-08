import {
  expiryStatus,
  formatCalendarDate,
  LICENCE_TYPE_LABELS,
  type LicenceType,
  type RenterStatus,
} from "@fleetapp/core";

import type { ExpiryContext } from "../vehicles/expiry-columns";
import { licenceIssuedInText } from "./licence-text";
import type { RenterBadge } from "./renter-list-status";

/** What a business's pages need to know about one of its drivers' standing. */
export interface DriverStanding {
  status: RenterStatus;
  licenceType: LicenceType | null;
  licenceIssuedIn: string | null;
  licenceCountry: string | null;
  licenceExpiresOn: string | null;
  isWaitingReview: boolean;
}

/**
 * A driver's one label on a business's pages, the most telling first: Do
 * not rent, details waiting for review, then the licence (not on file,
 * expired, due soon), else Current. Never the licence's number (rule 8).
 */
export function driverBadge(driver: DriverStanding, expiry: ExpiryContext): RenterBadge {
  if (driver.status === "do_not_rent") {
    return { text: "Do not rent", tone: "refused" };
  }
  if (driver.isWaitingReview) {
    return { text: "To review", tone: "booked" };
  }
  const status = expiryStatus(driver.licenceExpiresOn, expiry.today, expiry.warningDays);
  if (status === "none") {
    return { text: "Licence not on file", tone: "attention" };
  }
  if (status === "expired") {
    return { text: "Licence expired", tone: "danger" };
  }
  return status === "due_soon"
    ? { text: "Licence due", tone: "attention" }
    : { text: "Current", tone: "good" };
}

/** "Full · WA · to 3 Jun 2029", or "No licence on file yet". */
export function driverLicenceWords(driver: DriverStanding): string {
  if (!driver.licenceType || !driver.licenceExpiresOn) {
    return "No licence on file yet";
  }
  return [
    LICENCE_TYPE_LABELS[driver.licenceType],
    licenceIssuedInText(driver.licenceIssuedIn, driver.licenceCountry),
    `to ${formatCalendarDate(driver.licenceExpiresOn)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}
