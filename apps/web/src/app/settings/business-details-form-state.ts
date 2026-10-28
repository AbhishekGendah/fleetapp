/** Every text field on the form, by its name. */
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
] as const;

export type BusinessDetailTextField = (typeof BUSINESS_DETAIL_TEXT_FIELDS)[number];

export type BusinessDetailsFormState =
  | { status: "editing" }
  | { status: "saved"; hasPostcodeWarning: boolean }
  | {
      status: "invalid" | "failed";
      fieldErrors?: Partial<Record<string, string[]>>;
      formError?: string;
      values: Record<string, string>;
      isGstRegistered: boolean;
    };
