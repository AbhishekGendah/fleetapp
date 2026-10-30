import {
  ageOn,
  emptyForm,
  INVALID_EMAIL_MESSAGE,
  MINIMUM_DRIVER_AGE_YEARS,
  optionalLine,
  optionalPhone,
  RENTER_STATUSES,
  REQUIRED_MESSAGE,
  requiredLine,
  singleLineText,
  type RenterStatus,
} from "@fleetapp/core";
import { z } from "zod";

import { optionalDate } from "../vehicles/amount-input";

const CONTACT_NEEDED_MESSAGE = "Enter a phone number or an email address.";
const BIRTH_DATE_MESSAGE = `Check the date: a driver is at least ${MINIMUM_DRIVER_AGE_YEARS}.`;
/** The tick box sends this when ticked; nothing at all when not. */
export const TICKED_VALUE = "on";

const optionalEmail = singleLineText
  .toLowerCase()
  .transform((value) => (value === "" ? null : value))
  .pipe(z.email(INVALID_EMAIL_MESSAGE).nullable());

/**
 * A Renter's details, as on the add and edit forms. `today` is the
 * Operator's today, for the date-of-birth check. Only the name and a phone
 * or email are needed to save (decision 1 of docs/plans/phase-2-step-3.md).
 */
function renterInputSchema(today: string) {
  return z
    .object({
      fullName: requiredLine,
      preferredName: optionalLine,
      phone: optionalPhone,
      email: optionalEmail,
      dateOfBirth: optionalDate.refine(
        (date) => date === null || ageOn(date, today) >= MINIMUM_DRIVER_AGE_YEARS,
        BIRTH_DATE_MESSAGE,
      ),
      residentialAddress: optionalLine,
      isPostalSameAsHome: z.string().transform((value) => value === TICKED_VALUE),
      postalAddress: optionalLine,
      emergencyContactName: optionalLine,
      emergencyContactPhone: optionalPhone,
      emergencyContactRelationship: optionalLine,
    })
    .superRefine((input, context) => {
      if (input.phone === null && input.email === null) {
        for (const path of ["phone", "email"]) {
          context.addIssue({ code: "custom", path: [path], message: CONTACT_NEEDED_MESSAGE });
        }
      }
    })
    .transform(({ isPostalSameAsHome, postalAddress, ...details }) => ({
      ...details,
      // Null means "same as home", so a later change of home address carries over.
      postalAddress: isPostalSameAsHome ? null : postalAddress,
    }));
}

export type RenterInput = z.infer<ReturnType<typeof renterInputSchema>>;

export const RENTER_FORM_FIELDS = [
  "fullName",
  "preferredName",
  "phone",
  "email",
  "dateOfBirth",
  "residentialAddress",
  "isPostalSameAsHome",
  "postalAddress",
  "emergencyContactName",
  "emergencyContactPhone",
  "emergencyContactRelationship",
] as const;
export type RenterFormField = (typeof RENTER_FORM_FIELDS)[number];
export type RenterFormValues = Record<RenterFormField, string>;

const REQUIRED_RENTER_FIELDS: readonly RenterFormField[] = ["fullName"];

/** For the asterisk. Phone and email are "one or the other", explained by a hint instead. */
export function isRequiredRenterField(field: RenterFormField): boolean {
  return REQUIRED_RENTER_FIELDS.includes(field);
}

export function emptyRenterForm(): RenterFormValues {
  return { ...emptyForm(RENTER_FORM_FIELDS), isPostalSameAsHome: TICKED_VALUE };
}

export function parseRenterForm(
  values: RenterFormValues,
  today: string,
): z.ZodSafeParseResult<RenterInput> {
  return renterInputSchema(today).safeParse(values);
}

/** The edit form, filled in from what is saved. */
export function renterFormValues(renter: {
  [Field in keyof RenterInput]: string | null;
}): RenterFormValues {
  return {
    fullName: renter.fullName ?? "",
    preferredName: renter.preferredName ?? "",
    phone: renter.phone ?? "",
    email: renter.email ?? "",
    dateOfBirth: renter.dateOfBirth ?? "",
    residentialAddress: renter.residentialAddress ?? "",
    isPostalSameAsHome: renter.postalAddress === null ? TICKED_VALUE : "",
    postalAddress: renter.postalAddress ?? "",
    emergencyContactName: renter.emergencyContactName ?? "",
    emergencyContactPhone: renter.emergencyContactPhone ?? "",
    emergencyContactRelationship: renter.emergencyContactRelationship ?? "",
  };
}

const DO_NOT_RENT_REASON_MESSAGE = "Say why, so the next person to look knows. Facts only.";

/** Active, or Do not rent with the reason, which stays private to the Operator. */
export const renterStatusInputSchema = z
  .object({
    status: z.enum(RENTER_STATUSES, REQUIRED_MESSAGE),
    doNotRentReason: optionalLine,
  })
  .superRefine((input, context) => {
    if (input.status === "do_not_rent" && input.doNotRentReason === null) {
      context.addIssue({
        code: "custom",
        path: ["doNotRentReason"],
        message: DO_NOT_RENT_REASON_MESSAGE,
      });
    }
  })
  .transform((input) => ({
    status: input.status,
    doNotRentReason: input.status === "do_not_rent" ? input.doNotRentReason : null,
  }));

export type RenterStatusInput = z.infer<typeof renterStatusInputSchema>;
export const RENTER_STATUS_FIELDS = ["status", "doNotRentReason"] as const;
export type RenterStatusFormValues = Record<(typeof RENTER_STATUS_FIELDS)[number], string>;

export function renterStatusFormValues(renter: {
  status: RenterStatus;
  doNotRentReason: string | null;
}): RenterStatusFormValues {
  return { status: renter.status, doNotRentReason: renter.doNotRentReason ?? "" };
}
