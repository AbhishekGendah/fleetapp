import {
  emptyForm,
  formatAbn,
  optionalLine,
  optionalPhone,
  requiredAbn,
  requiredEmail,
  requiredLine,
} from "@fleetapp/core";
import { z } from "zod";

import { TICKED_VALUE } from "./renter-input";

/**
 * A business Renter's details, as on its add and edit forms
 * (docs/plans/business-renters.md, "How each flow changes"). The legal name,
 * ABN and the contact's name and email are needed to save: the contract,
 * invoices and statements go to that email (Abhi, 7 Nov 2026). Names are
 * free text (no format fits a business name); the ABN is checked with the
 * ATO's checksum and kept as its 11 digits (rule 31).
 */
const businessRenterInputSchema = z
  .object({
    fullName: requiredLine,
    tradingName: optionalLine,
    abn: requiredAbn,
    contactName: requiredLine,
    email: requiredEmail,
    phone: optionalPhone,
    businessAddress: optionalLine,
    isPostalSameAsBusiness: z.string().transform((value) => value === TICKED_VALUE),
    postalAddress: optionalLine,
  })
  .transform(({ isPostalSameAsBusiness, postalAddress, tradingName, ...details }) => ({
    ...details,
    // A trading name the same as the legal name says nothing more.
    tradingName: tradingName === details.fullName ? null : tradingName,
    // Null means "same as the business address", so a move carries over.
    postalAddress: isPostalSameAsBusiness ? null : postalAddress,
  }));

export type BusinessRenterInput = z.infer<typeof businessRenterInputSchema>;

export const BUSINESS_RENTER_FORM_FIELDS = [
  "fullName",
  "tradingName",
  "abn",
  "contactName",
  "email",
  "phone",
  "businessAddress",
  "isPostalSameAsBusiness",
  "postalAddress",
] as const;
export type BusinessRenterFormField = (typeof BUSINESS_RENTER_FORM_FIELDS)[number];
export type BusinessRenterFormValues = Record<BusinessRenterFormField, string>;

/** The details a business's record holds, in the order the log and the form list them. */
export const BUSINESS_RENTER_FIELDS = [
  "fullName",
  "tradingName",
  "abn",
  "contactName",
  "email",
  "phone",
  "businessAddress",
  "postalAddress",
] as const satisfies readonly (keyof BusinessRenterInput)[];

const REQUIRED_BUSINESS_FIELDS: readonly BusinessRenterFormField[] = [
  "fullName",
  "abn",
  "contactName",
  "email",
];

export function isRequiredBusinessRenterField(field: BusinessRenterFormField): boolean {
  return REQUIRED_BUSINESS_FIELDS.includes(field);
}

export function emptyBusinessRenterForm(): BusinessRenterFormValues {
  return { ...emptyForm(BUSINESS_RENTER_FORM_FIELDS), isPostalSameAsBusiness: TICKED_VALUE };
}

export function parseBusinessRenterForm(
  values: BusinessRenterFormValues,
): z.ZodSafeParseResult<BusinessRenterInput> {
  return businessRenterInputSchema.safeParse(values);
}

/** The edit form, filled in from what is saved; the ABN grouped as the box shows it. */
export function businessRenterFormValues(renter: {
  [Field in (typeof BUSINESS_RENTER_FIELDS)[number]]: string | null;
}): BusinessRenterFormValues {
  return {
    fullName: renter.fullName ?? "",
    tradingName: renter.tradingName ?? "",
    abn: renter.abn ? formatAbn(renter.abn) : "",
    contactName: renter.contactName ?? "",
    email: renter.email ?? "",
    phone: renter.phone ?? "",
    businessAddress: renter.businessAddress ?? "",
    isPostalSameAsBusiness: renter.postalAddress === null ? TICKED_VALUE : "",
    postalAddress: renter.postalAddress ?? "",
  };
}
