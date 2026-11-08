"use client";

import { fieldErrorsOf, formatAbn, formatAustralianPhone } from "@fleetapp/core";
import { Checkbox } from "@fleetapp/ui/checkbox";
import { FormField } from "@fleetapp/ui/form-field";
import { FormSection } from "@fleetapp/ui/form-section";
import { FormattedInput } from "@fleetapp/ui/formatted-input";
import { Input, RequiredFieldsNote } from "@fleetapp/ui/input";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import { useActionState, type ReactNode } from "react";

import { FormAddressBox } from "../../components/form-address-box";
import {
  BUSINESS_RENTER_FORM_FIELDS,
  isRequiredBusinessRenterField,
  parseBusinessRenterForm,
  type BusinessRenterFormField,
  type BusinessRenterFormValues,
} from "../../lib/renters/business-renter-input";
import { BUSINESS_RENTER_FIELD_LABELS } from "../../lib/renters/renter-labels";
import { TICKED_VALUE } from "../../lib/renters/renter-input";
import { RenterFormFooter } from "./renter-form";
import type { RenterFormState } from "./renter-form-state";

const INITIAL_STATE: RenterFormState = { status: "editing" };

/** What each box is for, under it (7 Nov 2026 mockups). */
const HINTS: Partial<Record<BusinessRenterFormField, string>> = {
  fullName: "As on the ABN register. Printed on invoices and the contract.",
  tradingName: "Shown first in your lists, if different.",
  abn: "11 digits. We check it is a valid ABN.",
  contactName: "Gets the invoices and signs for the business.",
  email: "The contract, invoices and statements are sent here.",
};

/**
 * Adding or editing a business Renter: its legal and trading names, ABN, the
 * contact who gets the invoices, and its addresses. Checked as typed with
 * the server's own schema (rule 28); the ABN is grouped 2-3-3-3 as it is
 * typed (rule 31). `before` goes under the required-fields note, e.g. the
 * Person or Business choice.
 */
export function BusinessRenterForm(props: {
  initialValues: BusinessRenterFormValues;
  action: (state: RenterFormState, formData: FormData) => Promise<RenterFormState>;
  submitLabel: string;
  cancelHref: string;
  before?: ReactNode;
  after?: ReactNode;
}) {
  const [state, formAction, isPending] = useActionState(props.action, INITIAL_STATE);
  const form = useFormFields({
    fields: BUSINESS_RENTER_FORM_FIELDS,
    initialValues: props.initialValues,
    validate: (values) => fieldErrorsOf(parseBusinessRenterForm(values)),
    isRequired: isRequiredBusinessRenterField,
  });
  const shownState = form.isResultShown && !isPending ? state : INITIAL_STATE;
  const isPostalSame = form.values.isPostalSameAsBusiness === TICKED_VALUE;

  function fieldProps(field: BusinessRenterFormField) {
    return {
      htmlFor: form.idFor(field),
      label: BUSINESS_RENTER_FIELD_LABELS[field],
      isRequired: isRequiredBusinessRenterField(field),
      hint: HINTS[field],
      error: form.errorFor(field),
    };
  }

  return (
    <form
      action={formAction}
      onSubmit={form.submitHandler(formAction)}
      noValidate
      className="flex flex-col gap-8"
    >
      <RequiredFieldsNote />
      {props.before}
      <FormSection title="Business details">
        <FormField {...fieldProps("fullName")}>
          <Input {...form.textBoxProps("fullName")} autoComplete="off" />
        </FormField>
        <FormField {...fieldProps("tradingName")}>
          <Input {...form.textBoxProps("tradingName")} autoComplete="off" />
        </FormField>
        <FormField {...fieldProps("abn")}>
          <FormattedInput
            {...form.formattedBoxProps("abn", formatAbn)}
            inputMode="numeric"
            autoComplete="off"
            placeholder="51 824 753 556"
          />
        </FormField>
      </FormSection>

      <FormSection title="Contact">
        <FormField {...fieldProps("contactName")}>
          <Input {...form.textBoxProps("contactName")} autoComplete="off" />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField {...fieldProps("email")}>
            <Input
              {...form.textBoxProps("email")}
              onChange={(event) => form.setValue("email", event.target.value.toLowerCase())}
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoComplete="off"
            />
          </FormField>
          <FormField {...fieldProps("phone")}>
            <FormattedInput
              {...form.formattedBoxProps("phone", formatAustralianPhone)}
              type="tel"
              inputMode="tel"
              autoComplete="off"
            />
          </FormField>
        </div>
      </FormSection>

      <FormSection title="Address">
        <FormField {...fieldProps("businessAddress")} hint="Start typing and pick the address.">
          <FormAddressBox form={form} field="businessAddress" />
        </FormField>
        <Checkbox
          name="isPostalSameAsBusiness"
          label={BUSINESS_RENTER_FIELD_LABELS.isPostalSameAsBusiness}
          checked={isPostalSame}
          onChange={(event) =>
            form.setValue("isPostalSameAsBusiness", event.target.checked ? TICKED_VALUE : "")
          }
        />
        {isPostalSame ? null : (
          <FormField {...fieldProps("postalAddress")}>
            <FormAddressBox form={form} field="postalAddress" />
          </FormField>
        )}
      </FormSection>

      {props.after}
      <RenterFormFooter
        state={shownState}
        isPending={isPending}
        submitLabel={props.submitLabel}
        cancelHref={props.cancelHref}
      />
    </form>
  );
}
