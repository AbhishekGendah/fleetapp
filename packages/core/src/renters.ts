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

/** No Australian state licenses a driver younger than this. */
export const MINIMUM_DRIVER_AGE_YEARS = 16;

/** Whole years old on `today` (both YYYY-MM-DD), counting a birthday as reached on the day. */
export function ageOn(dateOfBirth: string, today: string): number {
  const years = Number(today.slice(0, 4)) - Number(dateOfBirth.slice(0, 4));
  const hasHadBirthday = today.slice(5) >= dateOfBirth.slice(5);
  return hasHadBirthday ? years : years - 1;
}

/** What a Renter record must hold before they can rent (Phase 3 refuses until then). */
export const DETAILS_NEEDED_BEFORE_RENTING = [
  "dateOfBirth",
  "residentialAddress",
  "licence",
  "licenceScans",
] as const;
export type DetailNeededBeforeRenting = (typeof DETAILS_NEEDED_BEFORE_RENTING)[number];

export const DETAIL_NEEDED_LABELS: Readonly<Record<DetailNeededBeforeRenting, string>> = {
  dateOfBirth: "Date of birth",
  residentialAddress: "Home address",
  licence: "Licence details",
  licenceScans: "Licence front and back",
};

/** What is on file, as far as renting needs to know. */
export interface RenterCompleteness {
  dateOfBirth: string | null;
  residentialAddress: string | null;
  hasLicence: boolean;
  hasBothLicenceScans: boolean;
}

/** The details still missing, in the order the form asks for them. Empty when ready. */
export function detailsStillNeeded(renter: RenterCompleteness): DetailNeededBeforeRenting[] {
  const isPresent: Record<DetailNeededBeforeRenting, boolean> = {
    dateOfBirth: renter.dateOfBirth !== null,
    residentialAddress: renter.residentialAddress !== null,
    licence: renter.hasLicence,
    licenceScans: renter.hasBothLicenceScans,
  };
  return DETAILS_NEEDED_BEFORE_RENTING.filter((detail) => !isPresent[detail]);
}

/** "Sam Example (Sammy)": the preferred name only when it differs. */
export function renterDisplayName(fullName: string, preferredName: string | null): string {
  return preferredName && preferredName !== fullName ? `${fullName} (${preferredName})` : fullName;
}
