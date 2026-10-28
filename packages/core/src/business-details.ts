/**
 * The business details every rental contract and tax invoice needs: who the
 * business is, where it is, and how a Renter reaches it. The one list both the
 * Settings form and the setup checklist go by.
 */
export const REQUIRED_BUSINESS_DETAIL_FIELDS = [
  "legalName",
  "abn",
  "addressLine1",
  "suburb",
  "state",
  "postcode",
  "phone",
  "email",
] as const;

export type RequiredBusinessDetailField = (typeof REQUIRED_BUSINESS_DETAIL_FIELDS)[number];

export type RequiredBusinessDetails = Record<RequiredBusinessDetailField, string | null>;

const REQUIRED_FIELD_NAMES: ReadonlySet<string> = new Set(REQUIRED_BUSINESS_DETAIL_FIELDS);

export function isRequiredBusinessDetail(field: string): field is RequiredBusinessDetailField {
  return REQUIRED_FIELD_NAMES.has(field);
}

/** Every required detail is filled in with more than spaces. */
export function hasRequiredBusinessDetails(details: RequiredBusinessDetails): boolean {
  return REQUIRED_BUSINESS_DETAIL_FIELDS.every((field) => Boolean(details[field]?.trim()));
}
