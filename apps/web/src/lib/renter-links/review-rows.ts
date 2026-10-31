import { formatCalendarDate, LICENCE_CLASS_LABELS, LICENCE_TYPE_LABELS } from "@fleetapp/core";

import type { LicenceInput } from "../renters/licence-input";
import { licenceIssuedInText } from "../renters/licence-text";
import type { RenterInput } from "../renters/renter-input";
import { RENTER_FIELD_LABELS } from "../renters/renter-labels";

const NOT_GIVEN = "Not given";
const SAME_AS_HOME = "Same as home";

/** One detail as on file and as sent, in words. */
export interface ReviewRow {
  label: string;
  onFile: string;
  sent: string;
  isChanged: boolean;
}

type Nullable<Shape> = { [Key in keyof Shape]: Shape[Key] | null };
/** What is on file now: any detail may be missing, a Renter started from a phone call has little. */
export type OnFile = Nullable<RenterInput> & Nullable<LicenceInput>;

function dateText(date: string | null): string {
  return date ? formatCalendarDate(date) : "";
}

/** Each detail in the words the Renter page uses. */
const DETAIL_TEXTS: readonly [label: string, text: (values: OnFile) => string][] = [
  [RENTER_FIELD_LABELS.fullName, (values) => values.fullName ?? ""],
  [RENTER_FIELD_LABELS.preferredName, (values) => values.preferredName ?? ""],
  [RENTER_FIELD_LABELS.phone, (values) => values.phone ?? ""],
  [RENTER_FIELD_LABELS.email, (values) => values.email ?? ""],
  [RENTER_FIELD_LABELS.dateOfBirth, (values) => dateText(values.dateOfBirth)],
  [RENTER_FIELD_LABELS.residentialAddress, (values) => values.residentialAddress ?? ""],
  [RENTER_FIELD_LABELS.postalAddress, (values) => values.postalAddress ?? SAME_AS_HOME],
  [RENTER_FIELD_LABELS.emergencyContactName, (values) => values.emergencyContactName ?? ""],
  [RENTER_FIELD_LABELS.emergencyContactPhone, (values) => values.emergencyContactPhone ?? ""],
  [
    RENTER_FIELD_LABELS.emergencyContactRelationship,
    (values) => values.emergencyContactRelationship ?? "",
  ],
  [
    RENTER_FIELD_LABELS.licenceIssuedIn,
    (values) => licenceIssuedInText(values.licenceIssuedIn, values.licenceCountry),
  ],
  [RENTER_FIELD_LABELS.licenceNumber, (values) => values.licenceNumber ?? ""],
  [
    RENTER_FIELD_LABELS.licenceClass,
    (values) => (values.licenceClass ? LICENCE_CLASS_LABELS[values.licenceClass] : ""),
  ],
  [
    RENTER_FIELD_LABELS.licenceType,
    (values) => (values.licenceType ? LICENCE_TYPE_LABELS[values.licenceType] : ""),
  ],
  [RENTER_FIELD_LABELS.licenceExpiresOn, (values) => dateText(values.licenceExpiresOn)],
];

/**
 * Every detail as "on file → sent", so the Operator sees exactly what
 * approving would change. A Renter with no postal address on file has it
 * the same as home, so that compares as such.
 */
export function reviewRows(onFile: OnFile, sent: RenterInput & LicenceInput): ReviewRow[] {
  return DETAIL_TEXTS.map(([label, text]) => {
    const before = text(onFile);
    const after = text(sent);
    return {
      label,
      onFile: before || NOT_GIVEN,
      sent: after || NOT_GIVEN,
      isChanged: before !== after,
    };
  });
}
