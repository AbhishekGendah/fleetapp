"use client";

import { fieldErrorsOf, formatAustralianPhone } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { Checkbox } from "@fleetapp/ui/checkbox";
import { FormError } from "@fleetapp/ui/form-message";
import { FormField } from "@fleetapp/ui/form-field";
import { FormattedInput } from "@fleetapp/ui/formatted-input";
import { FormSection } from "@fleetapp/ui/form-section";
import { Input, RequiredFieldsNote } from "@fleetapp/ui/input";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import Link from "next/link";
import { useActionState } from "react";

import { AddressSearch } from "../../components/address-search";
import { singleLineAddress } from "../../lib/address-lookup/address-from-components";
import {
  isRequiredRenterField,
  parseRenterForm,
  RENTER_FORM_FIELDS,
  TICKED_VALUE,
  type RenterFormField,
  type RenterFormValues,
} from "../../lib/renters/renter-input";
import { RENTER_FIELD_LABELS } from "../../lib/renters/renter-labels";
import type { RenterFormState } from "./renter-form-state";

const INITIAL_STATE: RenterFormState = { status: "editing" };
const CONTACT_HINT = "A phone number or an email, or both.";

interface RenterFormProps {
  initialValues: RenterFormValues;
  /** The Operator's today, for the date-of-birth check. */
  today: string;
  action: (state: RenterFormState, formData: FormData) => Promise<RenterFormState>;
  submitLabel: string;
  cancelHref: string;
}

/**
 * Adding or editing a Renter. Only the name and a phone or email are needed
 * to save; the Renter's page then lists what is still needed before renting.
 */
export function RenterForm(props: RenterFormProps) {
  const [state, formAction, isPending] = useActionState(props.action, INITIAL_STATE);
  const form = useFormFields({
    fields: RENTER_FORM_FIELDS,
    initialValues: props.initialValues,
    validate: (values) => fieldErrorsOf(parseRenterForm(values, props.today)),
    isRequired: isRequiredRenterField,
  });
  const shownState = form.isResultShown && !isPending ? state : INITIAL_STATE;
  const isPostalSameAsHome = form.values.isPostalSameAsHome === TICKED_VALUE;

  function fieldProps(field: RenterFormField) {
    return {
      htmlFor: field,
      label: RENTER_FIELD_LABELS[field],
      isRequired: isRequiredRenterField(field),
      error: form.errorFor(field),
    };
  }

  function addressBox(field: "residentialAddress" | "postalAddress") {
    return (
      <AddressSearch
        {...form.boxProps(field)}
        placeholder="Start typing to search"
        autoComplete="off"
        onValueChange={(value) => form.setValue(field, value)}
        onAddressChosen={(address) => form.fillIn({ [field]: singleLineAddress(address) })}
        nearState={null}
      />
    );
  }

  return (
    <form
      action={formAction}
      onSubmit={form.submitHandler(formAction)}
      noValidate
      className="flex flex-col gap-8"
    >
      <RequiredFieldsNote />
      <FormSection title="The Renter">
        <FormField {...fieldProps("fullName")} hint="As on their licence.">
          <Input {...form.textBoxProps("fullName")} autoComplete="off" />
        </FormField>
        <FormField {...fieldProps("preferredName")} hint="What they like to be called.">
          <Input {...form.textBoxProps("preferredName")} autoComplete="off" />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField {...fieldProps("phone")} hint={CONTACT_HINT}>
            <FormattedInput
              {...form.formattedBoxProps("phone", formatAustralianPhone)}
              type="tel"
              inputMode="tel"
              autoComplete="off"
            />
          </FormField>
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
        </div>
        <FormField {...fieldProps("dateOfBirth")}>
          <Input {...form.textBoxProps("dateOfBirth")} type="date" max={props.today} />
        </FormField>
      </FormSection>

      <FormSection title="Address">
        <FormField {...fieldProps("residentialAddress")}>
          {addressBox("residentialAddress")}
        </FormField>
        <Checkbox
          name="isPostalSameAsHome"
          label={RENTER_FIELD_LABELS.isPostalSameAsHome}
          checked={isPostalSameAsHome}
          onChange={(event) =>
            form.setValue("isPostalSameAsHome", event.target.checked ? TICKED_VALUE : "")
          }
        />
        {isPostalSameAsHome ? null : (
          <FormField {...fieldProps("postalAddress")}>{addressBox("postalAddress")}</FormField>
        )}
      </FormSection>

      <FormSection title="Emergency contact">
        <FormField {...fieldProps("emergencyContactName")}>
          <Input {...form.textBoxProps("emergencyContactName")} autoComplete="off" />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField {...fieldProps("emergencyContactPhone")}>
            <FormattedInput
              {...form.formattedBoxProps("emergencyContactPhone", formatAustralianPhone)}
              type="tel"
              inputMode="tel"
              autoComplete="off"
            />
          </FormField>
          <FormField {...fieldProps("emergencyContactRelationship")}>
            <Input
              {...form.textBoxProps("emergencyContactRelationship")}
              placeholder="e.g. Partner"
              autoComplete="off"
            />
          </FormField>
        </div>
      </FormSection>

      {shownState.status === "failed" ? <FormError message={shownState.formError} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
          {isPending ? "Saving…" : props.submitLabel}
        </Button>
        <Button asChild variant="ghost" className="w-full sm:w-auto">
          <Link href={props.cancelHref}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
