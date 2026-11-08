/**
 * The rules for an Operator's Renters (docs/design/03). Pure: the form checks
 * them as you type and the server checks them again on save.
 */

/** Whether the Operator will rent to them. Archiving is separate, as for cars. */
export const RENTER_STATUSES = ["active", "do_not_rent"] as const;
export type RenterStatus = (typeof RENTER_STATUSES)[number];

export const RENTER_STATUS_LABELS: Readonly<Record<RenterStatus, string>> = {
  active: "Active",
  do_not_rent: "Do not rent",
};

/**
 * A person, or a business (a company, partnership or trust) whose cars are
 * driven by person Renters it names (docs/plans/business-renters.md). Called
 * "organisation" in code because "business" already means the Operator.
 * Fixed when the Renter is added.
 */
export const RENTER_KINDS = ["person", "organisation"] as const;
export type RenterKind = (typeof RENTER_KINDS)[number];

export const RENTER_KIND_LABELS: Readonly<Record<RenterKind, string>> = {
  person: "Person",
  organisation: "Business",
};

/** No Australian state licenses a driver younger than this. */
export const MINIMUM_DRIVER_AGE_YEARS = 16;

/** Whole years old on `today` (both YYYY-MM-DD), counting a birthday as reached on the day. */
export function ageOn(dateOfBirth: string, today: string): number {
  const years = Number(today.slice(0, 4)) - Number(dateOfBirth.slice(0, 4));
  const hasHadBirthday = today.slice(5) >= dateOfBirth.slice(5);
  return hasHadBirthday ? years : years - 1;
}

/**
 * What a Renter record must hold before they can rent (Phase 3 refuses until
 * then), most important first: a licence that is current comes before all else.
 */
export const DETAILS_NEEDED_BEFORE_RENTING = [
  "licence",
  "currentLicence",
  "licenceScans",
  "dateOfBirth",
  "residentialAddress",
] as const;
export type DetailNeededBeforeRenting = (typeof DETAILS_NEEDED_BEFORE_RENTING)[number];

export const DETAIL_NEEDED_LABELS: Readonly<Record<DetailNeededBeforeRenting, string>> = {
  licence: "Licence details",
  currentLicence: "A current licence: the one on file has expired",
  licenceScans: "Licence front and back",
  dateOfBirth: "Date of birth",
  residentialAddress: "Home address",
};

/** What is on file, as far as renting needs to know. */
export interface RenterCompleteness {
  dateOfBirth: string | null;
  residentialAddress: string | null;
  /** Null when no licence is on file. */
  licenceExpiresOn: string | null;
  hasBothLicenceScans: boolean;
  /** The Operator's today: a licence expiring today still counts. */
  today: string;
}

/** The details still missing, most important first. Empty when ready to rent. */
export function detailsStillNeeded(renter: RenterCompleteness): DetailNeededBeforeRenting[] {
  const { licenceExpiresOn } = renter;
  const isMissing: Record<DetailNeededBeforeRenting, boolean> = {
    licence: licenceExpiresOn === null,
    currentLicence: licenceExpiresOn !== null && licenceExpiresOn < renter.today,
    licenceScans: !renter.hasBothLicenceScans,
    dateOfBirth: renter.dateOfBirth === null,
    residentialAddress: renter.residentialAddress === null,
  };
  return DETAILS_NEEDED_BEFORE_RENTING.filter((detail) => isMissing[detail]);
}

/** The first word of a full name, e.g. "Jamie" from "Jamie Park". */
export function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName;
}

/** What to call a Renter in a short line ("How Jamie pays"): their preferred name, else their first name. */
export function renterFirstName(fullName: string, preferredName: string | null): string {
  return preferredName?.trim() || firstNameOf(fullName);
}

/** "Sam Example (Sammy)": the preferred name only when it differs. */
export function renterDisplayName(fullName: string, preferredName: string | null): string {
  return preferredName && preferredName !== fullName ? `${fullName} (${preferredName})` : fullName;
}

/** What a Renter is called in a list or on their page, whichever kind. */
export interface RenterNames {
  kind: RenterKind;
  /** A person's full name, or a business's legal name. */
  fullName: string;
  preferredName: string | null;
  tradingName: string | null;
}

/**
 * A business by its trading name when it has one (what the Operator calls
 * it: "Acme Rides"), else its legal name; a person as `renterDisplayName`.
 */
export function renterShownName(renter: RenterNames): string {
  if (renter.kind === "organisation") {
    return renter.tradingName?.trim() || renter.fullName;
  }
  return renterDisplayName(renter.fullName, renter.preferredName);
}
