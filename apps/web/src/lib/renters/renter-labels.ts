import {
  formatCalendarDate,
  RENTER_KIND_LABELS,
  RENTER_STATUS_LABELS,
  WITHHELD_VALUE,
} from "@fleetapp/core";

import type { BusinessRenterFormField } from "./business-renter-input";
import type { LicenceFormField } from "./licence-input";
import type { PersonRenterFormField } from "./renter-input";

type RenterLabelledField = PersonRenterFormField | LicenceFormField | "status" | "doNotRentReason";

/** What each Renter field is called, on the forms, the Details tab and in the Log. */
export const RENTER_FIELD_LABELS: Readonly<Record<RenterLabelledField, string>> = {
  fullName: "Full name",
  preferredName: "Preferred name",
  phone: "Phone",
  email: "Email",
  dateOfBirth: "Date of birth",
  residentialAddress: "Home address",
  isPostalSameAsHome: "Postal address is the same as home",
  postalAddress: "Postal address",
  emergencyContactName: "Emergency contact's name",
  emergencyContactPhone: "Emergency contact's phone",
  emergencyContactRelationship: "Relationship to the Renter",
  abn: "ABN",
  status: "Status",
  doNotRentReason: "Why not rent to them",
  licenceIssuedIn: "Issued in",
  licenceCountry: "Country",
  licenceNumber: "Licence number",
  licenceClass: "Class",
  licenceType: "Type",
  licenceExpiresOn: "Expires",
};

type BusinessLabelledField = BusinessRenterFormField | "status" | "doNotRentReason";

/** What each business Renter field is called (its full name is its legal name; its phone and email are its contact's). */
export const BUSINESS_RENTER_FIELD_LABELS: Readonly<Record<BusinessLabelledField, string>> = {
  fullName: "Legal name",
  tradingName: "Trading name",
  abn: "ABN",
  contactName: "Contact's name",
  email: "Contact's email",
  phone: "Contact's phone",
  businessAddress: "Business address",
  isPostalSameAsBusiness: "Postal address is the same as the business address",
  postalAddress: "Postal address",
  status: RENTER_FIELD_LABELS.status,
  doNotRentReason: "Why not rent to it",
};

/**
 * What only the Log holds: a Renter's kind, written when a business is
 * added, and the two sides of a driver's link to a business.
 */
const LOG_FIELD_LABELS: Readonly<Record<string, string>> = {
  kind: "Kind",
  organisationId: "Business",
  driverId: "Driver",
};

/** The Log keeps which business and driver a link joins as ids: shown as neither the id nor a name (rule 7). */
const LINKED_RECORD_FIELDS: ReadonlySet<string> = new Set(["organisationId", "driverId"]);

function labelIn(labels: Readonly<Record<string, string>>, field: string): string {
  if (Object.hasOwn(labels, field)) {
    return labels[field]!;
  }
  return Object.hasOwn(LOG_FIELD_LABELS, field) ? LOG_FIELD_LABELS[field]! : field;
}

export function renterFieldLabel(field: string): string {
  return labelIn(RENTER_FIELD_LABELS, field);
}

export function businessRenterFieldLabel(field: string): string {
  return labelIn(BUSINESS_RENTER_FIELD_LABELS, field);
}

/** A stored Renter value in words. Personal details are withheld from the Log, so show as "not shown". */
export function describeRenterValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "blank";
  }
  if (value === WITHHELD_VALUE || LINKED_RECORD_FIELDS.has(field)) {
    return "not shown";
  }
  const text = String(value);
  if (field === "kind" && Object.hasOwn(RENTER_KIND_LABELS, text)) {
    return RENTER_KIND_LABELS[text as keyof typeof RENTER_KIND_LABELS];
  }
  if (field === "status" && Object.hasOwn(RENTER_STATUS_LABELS, text)) {
    return RENTER_STATUS_LABELS[text as keyof typeof RENTER_STATUS_LABELS];
  }
  return field === "dateOfBirth" ? formatCalendarDate(text) : text;
}
