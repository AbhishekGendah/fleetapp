import { emptyForm, REQUIRED_MESSAGE } from "@fleetapp/core";
import type { z } from "zod";

import {
  LICENCE_FORM_FIELDS,
  parseLicenceForm,
  type LicenceFormValues,
  type LicenceInput,
} from "../renters/licence-input";
import {
  emptyRenterForm,
  parseRenterForm,
  RENTER_FORM_FIELDS,
  type RenterFormValues,
  type RenterInput,
} from "../renters/renter-input";

/**
 * The form a Renter fills in through their link: their details and licence,
 * checked by the same rules as the Operator's forms, with what renting needs
 * (date of birth, home address, the licence) required.
 */
export const DETAILS_FORM_FIELDS = [...RENTER_FORM_FIELDS, ...LICENCE_FORM_FIELDS] as const;
export type DetailsFormField = (typeof DETAILS_FORM_FIELDS)[number];
export type DetailsFormValues = RenterFormValues & LicenceFormValues;

/** Needed to send, beyond the Operator's own form's rules. */
const NEEDED_TO_RENT: readonly DetailsFormField[] = ["dateOfBirth", "residentialAddress"];

export type DetailsInput = {
  details: RenterInput & { dateOfBirth: string; residentialAddress: string };
} & {
  licence: LicenceInput;
};

type FieldErrors = Partial<Record<DetailsFormField, string[]>>;

function errorsOf<Output>(result: z.ZodSafeParseResult<Output>): FieldErrors {
  if (result.success) {
    return {};
  }
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as DetailsFormField | undefined;
    if (field) {
      errors[field] = [...(errors[field] ?? []), issue.message];
    }
  }
  return errors;
}

/** Checks the whole form: `today` is the Operator's today. Errors per box, or what to save. */
export function parseDetailsForm(
  values: DetailsFormValues,
  today: string,
): { success: true; data: DetailsInput } | { success: false; errors: FieldErrors } {
  const details = parseRenterForm(values, today);
  const licence = parseLicenceForm(values);
  const errors: FieldErrors = { ...errorsOf(details), ...errorsOf(licence) };
  for (const field of NEEDED_TO_RENT) {
    if (values[field].trim() === "") {
      errors[field] = [REQUIRED_MESSAGE];
    }
  }
  if (!details.success || !licence.success || Object.keys(errors).length > 0) {
    return { success: false, errors };
  }
  return {
    success: true,
    data: {
      // Both were checked as filled in just above, which the type cannot see.
      details: details.data as DetailsInput["details"],
      licence: licence.data,
    },
  };
}

export function isRequiredDetailsField(
  field: DetailsFormField,
  values: DetailsFormValues,
): boolean {
  if (field === "fullName" || NEEDED_TO_RENT.includes(field)) {
    return true;
  }
  if (field === "licenceCountry") {
    return values.licenceIssuedIn === "overseas";
  }
  return (LICENCE_FORM_FIELDS as readonly string[]).includes(field);
}

/** The form to start from: the Renter's details as on file, the licence empty (never shown back). */
export function detailsFormStart(renterValues: RenterFormValues): DetailsFormValues {
  return {
    ...emptyRenterForm(),
    ...renterValues,
    ...emptyForm(LICENCE_FORM_FIELDS),
    licenceClass: "C",
    licenceType: "full",
  };
}
