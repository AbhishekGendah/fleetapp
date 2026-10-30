"use client";

import {
  AUSTRALIAN_STATE_CODES,
  fieldErrorsOf,
  LICENCE_CLASS_LABELS,
  LICENCE_CLASSES,
  LICENCE_TYPE_LABELS,
  LICENCE_TYPES,
  licenceNumberMaximumLength,
  normaliseLicenceNumber,
  OVERSEAS_ISSUER,
  overseasCountryOptions,
} from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import { Select } from "@fleetapp/ui/select";

import { ChangeFormShell, useChangeForm } from "../../../components/change-form-shell";
import {
  LICENCE_FORM_FIELDS,
  parseLicenceForm,
  type LicenceFormField,
  type LicenceFormValues,
} from "../../../lib/renters/licence-input";
import { RENTER_FIELD_LABELS } from "../../../lib/renters/renter-labels";

const COUNTRY_OPTIONS = overseasCountryOptions();
const OVERSEAS_HINT =
  "Visitors can drive on it for a limited time, and it must be in English or come with an International Driving Permit.";

/** The Renter's licence, as on the card. One per Renter: a renewed licence is an edit. */
export function LicenceForm(props: {
  initialValues: LicenceFormValues;
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
  submitLabel: string;
}) {
  const changeForm = useChangeForm({
    action: props.action,
    fields: LICENCE_FORM_FIELDS,
    initialValues: props.initialValues,
    validate: (values) => fieldErrorsOf(parseLicenceForm(values)),
    // The country box only shows for an overseas licence, where it is needed.
    isRequired: () => true,
  });
  const form = changeForm.fields;
  const isOverseas = form.values.licenceIssuedIn === OVERSEAS_ISSUER;

  function fieldProps(field: LicenceFormField) {
    return {
      htmlFor: field,
      label: RENTER_FIELD_LABELS[field],
      isRequired: true,
      error: form.errorFor(field),
    };
  }

  function handleIssuerChange(issuedIn: string): void {
    form.setValue("licenceIssuedIn", issuedIn);
    form.setValue(
      "licenceNumber",
      normaliseLicenceNumber(form.values.licenceNumber, licenceNumberMaximumLength(issuedIn)),
    );
  }

  return (
    <ChangeFormShell form={changeForm} submitLabel={props.submitLabel}>
      <FormField {...fieldProps("licenceIssuedIn")} hint={isOverseas ? OVERSEAS_HINT : undefined}>
        <Select
          {...form.boxProps("licenceIssuedIn")}
          onChange={(event) => handleIssuerChange(event.target.value)}
        >
          <option value="">Choose…</option>
          {AUSTRALIAN_STATE_CODES.map((state) => (
            <option key={state} value={state}>
              {state}
            </option>
          ))}
          <option value={OVERSEAS_ISSUER}>Overseas</option>
        </Select>
      </FormField>
      {isOverseas ? (
        <FormField {...fieldProps("licenceCountry")}>
          <Select
            {...form.boxProps("licenceCountry")}
            onChange={(event) => form.setValue("licenceCountry", event.target.value)}
          >
            <option value="">Choose…</option>
            {COUNTRY_OPTIONS.map((country) => (
              <option key={country.value} value={country.value}>
                {country.label}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}
      <FormField {...fieldProps("licenceNumber")} hint="As on the card. Spaces are left out.">
        <Input
          {...form.textBoxProps("licenceNumber")}
          onChange={(event) =>
            form.setValue(
              "licenceNumber",
              normaliseLicenceNumber(
                event.target.value,
                licenceNumberMaximumLength(form.values.licenceIssuedIn),
              ),
            )
          }
          autoCapitalize="characters"
          autoComplete="off"
        />
      </FormField>
      <div className="grid grid-cols-2 gap-4">
        <FormField {...fieldProps("licenceClass")}>
          <Select
            {...form.boxProps("licenceClass")}
            onChange={(event) => form.setValue("licenceClass", event.target.value)}
          >
            {LICENCE_CLASSES.map((licenceClass) => (
              <option key={licenceClass} value={licenceClass}>
                {LICENCE_CLASS_LABELS[licenceClass]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField {...fieldProps("licenceType")}>
          <Select
            {...form.boxProps("licenceType")}
            onChange={(event) => form.setValue("licenceType", event.target.value)}
          >
            {LICENCE_TYPES.map((licenceType) => (
              <option key={licenceType} value={licenceType}>
                {LICENCE_TYPE_LABELS[licenceType]}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <FormField {...fieldProps("licenceExpiresOn")}>
        <Input {...form.textBoxProps("licenceExpiresOn")} type="date" />
      </FormField>
    </ChangeFormShell>
  );
}
