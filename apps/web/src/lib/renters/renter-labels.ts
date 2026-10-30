import { formatCalendarDate, RENTER_STATUS_LABELS, WITHHELD_VALUE } from "@fleetapp/core";

import type { LicenceFormField } from "./licence-input";
import type { RenterFormField } from "./renter-input";

type RenterLabelledField = RenterFormField | LicenceFormField | "status" | "doNotRentReason";

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
  status: "Status",
  doNotRentReason: "Why not rent to them",
  licenceIssuedIn: "Issued in",
  licenceCountry: "Country",
  licenceNumber: "Licence number",
  licenceClass: "Class",
  licenceType: "Type",
  licenceExpiresOn: "Expires",
};

function isLabelledField(field: string): field is RenterLabelledField {
  return Object.hasOwn(RENTER_FIELD_LABELS, field);
}

export function renterFieldLabel(field: string): string {
  return isLabelledField(field) ? RENTER_FIELD_LABELS[field] : field;
}

/** A stored Renter value in words. Personal details are withheld from the Log, so show as "not shown". */
export function describeRenterValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "blank";
  }
  if (value === WITHHELD_VALUE) {
    return "not shown";
  }
  const text = String(value);
  if (field === "status" && Object.hasOwn(RENTER_STATUS_LABELS, text)) {
    return RENTER_STATUS_LABELS[text as keyof typeof RENTER_STATUS_LABELS];
  }
  return field === "dateOfBirth" ? formatCalendarDate(text) : text;
}
