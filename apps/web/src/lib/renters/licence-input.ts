import {
  isOverseasCountryCode,
  LICENCE_CLASSES,
  LICENCE_ISSUERS,
  LICENCE_TYPES,
  licenceNumberMaximumLength,
  normaliseLicenceNumber,
  OVERSEAS_ISSUER,
  REQUIRED_MESSAGE,
  type LicenceClass,
  type LicenceIssuer,
  type LicenceType,
} from "@fleetapp/core";
import { z } from "zod";

import { requiredDate } from "../vehicles/amount-input";

const COUNTRY_MESSAGE = "Choose the country that issued it.";

function tidiedNumber(input: { licenceIssuedIn: string; licenceNumber: string }): string {
  return normaliseLicenceNumber(
    input.licenceNumber,
    licenceNumberMaximumLength(input.licenceIssuedIn),
  );
}

/** A Renter's licence, as on the Licence tab's form. Saved and checked the same way. */
const licenceInputSchema = z
  .object({
    licenceIssuedIn: z.enum(LICENCE_ISSUERS, REQUIRED_MESSAGE),
    licenceCountry: z.string().trim(),
    // Checked on its own, so it shows even before "Issued in" is chosen. The
    // longest limit, since only emptiness matters here.
    licenceNumber: z
      .string()
      .refine(
        (number) =>
          normaliseLicenceNumber(number, licenceNumberMaximumLength(OVERSEAS_ISSUER)) !== "",
        REQUIRED_MESSAGE,
      ),
    licenceClass: z.enum(LICENCE_CLASSES, REQUIRED_MESSAGE),
    licenceType: z.enum(LICENCE_TYPES, REQUIRED_MESSAGE),
    licenceExpiresOn: requiredDate,
  })
  // A refinement, not part of the tidy-up below, so these show alongside any
  // other box's problem rather than only once everything else is right.
  .superRefine((input, context) => {
    if (input.licenceIssuedIn === OVERSEAS_ISSUER && !isOverseasCountryCode(input.licenceCountry)) {
      context.addIssue({ code: "custom", path: ["licenceCountry"], message: COUNTRY_MESSAGE });
    }
  })
  .transform((input) => ({
    ...input,
    licenceCountry: input.licenceIssuedIn === OVERSEAS_ISSUER ? input.licenceCountry : null,
    licenceNumber: tidiedNumber(input),
  }));

export type LicenceInput = z.infer<typeof licenceInputSchema>;

export const LICENCE_FORM_FIELDS = [
  "licenceIssuedIn",
  "licenceCountry",
  "licenceNumber",
  "licenceClass",
  "licenceType",
  "licenceExpiresOn",
] as const;
export type LicenceFormField = (typeof LICENCE_FORM_FIELDS)[number];
export type LicenceFormValues = Record<LicenceFormField, string>;

export function parseLicenceForm(values: LicenceFormValues): z.ZodSafeParseResult<LicenceInput> {
  return licenceInputSchema.safeParse(values);
}

/** The licence on file, or a blank form starting on a car licence from the Renter's state. */
export function licenceFormValues(renter: {
  licenceIssuedIn: LicenceIssuer | null;
  licenceCountry: string | null;
  licenceNumber: string | null;
  licenceClass: LicenceClass | null;
  licenceType: LicenceType | null;
  licenceExpiresOn: string | null;
}): LicenceFormValues {
  return {
    licenceIssuedIn: renter.licenceIssuedIn ?? "",
    licenceCountry: renter.licenceCountry ?? "",
    licenceNumber: renter.licenceNumber ?? "",
    licenceClass: renter.licenceClass ?? "C",
    licenceType: renter.licenceType ?? "full",
    licenceExpiresOn: renter.licenceExpiresOn ?? "",
  };
}
