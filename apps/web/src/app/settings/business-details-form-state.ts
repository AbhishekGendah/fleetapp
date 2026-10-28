import type { BusinessDetailsFormValues } from "../../lib/settings/business-details-input";

/** Every text field on the form, by its name, in the order they appear. */
export const BUSINESS_DETAIL_TEXT_FIELDS = [
  "legalName",
  "tradingName",
  "abn",
  "gstRegisteredFrom",
  "addressLine1",
  "addressLine2",
  "suburb",
  "state",
  "postcode",
  "phone",
  "email",
  "timezone",
] as const satisfies readonly (keyof BusinessDetailsFormValues)[];

export type BusinessDetailTextField = (typeof BUSINESS_DETAIL_TEXT_FIELDS)[number];

/**
 * What a save came back with. The form keeps what was typed itself, so a
 * refusal needs to carry only the message.
 */
export type BusinessDetailsFormState =
  | { status: "editing" }
  | { status: "saved"; hasPostcodeWarning: boolean }
  | { status: "failed"; formError: string };
