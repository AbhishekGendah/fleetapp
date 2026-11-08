import type { RenterKind, RenterStatus } from "./renters";

/**
 * The rules for business Renters and the people who drive for them
 * (docs/plans/business-renters.md). Pure: the screens and the server ask the
 * same questions; the database holds the same lines as a second layer.
 */

/** What a business must have on file before it rents (slice 3 refuses until then). */
export const BUSINESS_DETAILS_NEEDED = ["abn", "contactName", "email", "businessAddress"] as const;
export type BusinessDetailNeeded = (typeof BUSINESS_DETAILS_NEEDED)[number];

export const BUSINESS_DETAIL_NEEDED_LABELS: Readonly<Record<BusinessDetailNeeded, string>> = {
  abn: "ABN",
  contactName: "Contact's name",
  email: "Contact's email",
  businessAddress: "Business address",
};

export type BusinessCompleteness = Record<BusinessDetailNeeded, string | null>;

/** The business's details still missing, in the form's order. Empty when it is ready to rent. */
export function businessDetailsStillNeeded(business: BusinessCompleteness): BusinessDetailNeeded[] {
  return BUSINESS_DETAILS_NEEDED.filter((detail) => !business[detail]?.trim());
}

/** Who is being added as a business's driver, as far as the rules need to know. */
export interface DriverCandidate {
  kind: RenterKind;
  status: RenterStatus;
  isArchived: boolean;
  /** Their personal details were removed seven years on: they are never given new records. */
  isRetired: boolean;
  /** Already a current driver of this business. */
  isCurrentDriver: boolean;
}

export type DriverToAddProblem =
  "not_a_person" | "details_removed" | "archived" | "do_not_rent" | "already_a_driver";

/**
 * Why this Renter can't be added as the business's driver, or null if they
 * can. A driver is a person (a business never drives for another); an
 * archived one is restored first; one marked Do not rent could never be
 * named on a car, so is not offered either (plan, "Do not rent").
 */
export function driverToAddProblem(candidate: DriverCandidate): DriverToAddProblem | null {
  if (candidate.kind !== "person") {
    return "not_a_person";
  }
  if (candidate.isRetired) {
    return "details_removed";
  }
  if (candidate.isArchived) {
    return "archived";
  }
  if (candidate.status === "do_not_rent") {
    return "do_not_rent";
  }
  return candidate.isCurrentDriver ? "already_a_driver" : null;
}

/** What stands in the way of archiving a Renter: the friendly side of the database's refusals. */
export interface ArchiveStanding {
  kind: RenterKind;
  /** A rental they rent or drive is booked or out. */
  hasRentalUnderWay: boolean;
  /** Current driver links: a business's drivers, or the businesses a person drives for. */
  currentDriverLinks: number;
}

export type ArchiveProblem = "in_use" | "has_drivers" | "drives_for";

/**
 * Why a Renter can't be archived yet, or null if they can: a rental booked
 * or out comes first; then a business with current drivers, or a person who
 * still drives for a business (both are current customers; the link holds
 * back the seven-year retention).
 */
export function archiveProblem(standing: ArchiveStanding): ArchiveProblem | null {
  if (standing.hasRentalUnderWay) {
    return "in_use";
  }
  if (standing.currentDriverLinks === 0) {
    return null;
  }
  return standing.kind === "organisation" ? "has_drivers" : "drives_for";
}
