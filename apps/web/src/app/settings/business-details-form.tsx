"use client";

import {
  AUSTRALIAN_TIMEZONES,
  formatAbn,
  formatAustralianPhone,
  formatPostcode,
  isRequiredBusinessDetail,
  MAXIMUM_LINE_LENGTH,
  isAustralianStateCode,
  POSTCODE_PATTERN,
  postcodeMatchesState,
  stateForTimezone,
  type AustralianStateCode,
} from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { Checkbox } from "@fleetapp/ui/checkbox";
import { FormError } from "@fleetapp/ui/form-message";
import { FormattedInput } from "@fleetapp/ui/formatted-input";
import { FormSection } from "@fleetapp/ui/form-section";
import { fieldErrorId, FormField } from "@fleetapp/ui/form-field";
import { Input, RequiredFieldsNote } from "@fleetapp/ui/input";
import { Select } from "@fleetapp/ui/select";
import { AustralianStateOptions } from "@fleetapp/ui/state-options";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import { useActionState, useState } from "react";
import { z } from "zod";

import { AddressSearch } from "../../components/address-search";
import type { BusinessDetails } from "../../lib/settings/business-details";
import {
  parseBusinessDetailsForm,
  type BusinessDetailsFormValues,
} from "../../lib/settings/business-details-input";
import { saveBusinessDetailsAction } from "./actions";
import {
  BUSINESS_DETAIL_TEXT_FIELDS,
  type BusinessDetailsFormState,
  type BusinessDetailTextField,
} from "./business-details-form-state";

const INITIAL_STATE: BusinessDetailsFormState = { status: "editing" };

const POSTCODE_WARNING =
  "Saved. That postcode does not usually belong to that state: check it is right.";

function savedValues(details: BusinessDetails): BusinessDetailsFormValues {
  return {
    legalName: details.legalName,
    tradingName: details.tradingName ?? "",
    abn: details.abn ? formatAbn(details.abn) : "",
    gstRegisteredFrom: details.gstRegisteredFrom ?? "",
    addressLine1: details.addressLine1 ?? "",
    addressLine2: details.addressLine2 ?? "",
    suburb: details.suburb ?? "",
    state: details.state ?? "",
    postcode: details.postcode ?? "",
    phone: details.phone ? formatAustralianPhone(details.phone) : "",
    email: details.email ?? "",
    timezone: details.timezone,
  };
}

/** Warned about, never refused: postcode ranges have exceptions. */
function hasUnusualPostcode(values: BusinessDetailsFormValues): boolean {
  if (!isAustralianStateCode(values.state) || !POSTCODE_PATTERN.test(values.postcode)) {
    return false;
  }
  return !postcodeMatchesState(values.postcode, values.state);
}

/** The state to suggest addresses in first: the one chosen, else the timezone's. */
function suggestionState(values: BusinessDetailsFormValues): AustralianStateCode | null {
  return isAustralianStateCode(values.state) ? values.state : stateForTimezone(values.timezone);
}

/**
 * Starred on the form: the details a contract needs, plus the timezone and
 * the GST date, which is only shown (and only needed) once GST is ticked.
 */
function isRequiredField(name: BusinessDetailTextField): boolean {
  return isRequiredBusinessDetail(name) || name === "timezone" || name === "gstRegisteredFrom";
}

interface FieldProps {
  name: BusinessDetailTextField;
  label: string;
  error: string | undefined;
  hint?: string;
  children: React.ReactNode;
}

function Field(props: FieldProps) {
  return (
    <FormField
      htmlFor={props.name}
      label={props.label}
      isRequired={isRequiredField(props.name)}
      hint={props.hint}
      error={props.error}
    >
      {props.children}
    </FormField>
  );
}

/** Checked as you type with the same rules the server applies on save (rule 28). */
export function BusinessDetailsForm({ details }: { details: BusinessDetails }) {
  const [state, formAction, isPending] = useActionState(saveBusinessDetailsAction, INITIAL_STATE);
  const [isGstRegistered, setIsGstRegistered] = useState(details.gstRegistered);
  const form = useFormFields({
    fields: BUSINESS_DETAIL_TEXT_FIELDS,
    initialValues: savedValues(details),
    validate: (values) => {
      const parsed = parseBusinessDetailsForm(values, isGstRegistered);
      return parsed.success ? {} : z.flattenError(parsed.error).fieldErrors;
    },
    isRequired: isRequiredField,
    maxLength: MAXIMUM_LINE_LENGTH,
  });
  const { values, errorFor, boxProps, textBoxProps, formattedBoxProps } = form;

  return (
    <form action={formAction} onSubmit={form.submitHandler(formAction)} noValidate className="flex flex-col gap-8">
      <RequiredFieldsNote />
      <FormSection title="Your business">
        <Field name="legalName" label="Legal name" error={errorFor("legalName")}>
          <Input {...textBoxProps("legalName")} autoComplete="organization" />
        </Field>
        <Field
          name="tradingName"
          label="Trading name"
          hint="Shown to Renters instead of the legal name, if given."
          error={errorFor("tradingName")}
        >
          <Input {...textBoxProps("tradingName")} />
        </Field>
        <Field name="abn" label="ABN" error={errorFor("abn")}>
          <FormattedInput
            {...formattedBoxProps("abn", formatAbn)}
            inputMode="numeric"
            placeholder="51 824 753 556"
          />
        </Field>
      </FormSection>

      <FormSection title="GST">
        <Checkbox
          name="gstRegistered"
          label="This business is registered for GST"
          checked={isGstRegistered}
          onChange={(event) => {
            setIsGstRegistered(event.target.checked);
            form.markChanged();
          }}
        />
        {isGstRegistered ? (
          <Field
            name="gstRegisteredFrom"
            label="Registered from"
            error={errorFor("gstRegisteredFrom")}
          >
            <Input {...textBoxProps("gstRegisteredFrom")} type="date" />
          </Field>
        ) : null}
      </FormSection>

      <FormSection title="Address">
        <Field name="addressLine1" label="Street address" error={errorFor("addressLine1")}>
          <AddressSearch
            {...boxProps("addressLine1")}
            maxLength={MAXIMUM_LINE_LENGTH}
            placeholder="Start typing to search"
            onValueChange={(value) => form.setValue("addressLine1", value)}
            onAddressChosen={form.fillIn}
            nearState={suggestionState(values)}
          />
        </Field>
        <Field name="addressLine2" label="Address line 2" error={errorFor("addressLine2")}>
          <Input {...textBoxProps("addressLine2")} autoComplete="address-line2" />
        </Field>
        <Field name="suburb" label="Suburb" error={errorFor("suburb")}>
          <Input {...textBoxProps("suburb")} autoComplete="address-level2" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field name="state" label="State" error={errorFor("state")}>
            <Select
              {...boxProps("state")}
              autoComplete="address-level1"
              onChange={(event) => form.setValue("state", event.target.value)}
            >
              <AustralianStateOptions />
            </Select>
          </Field>
          <Field name="postcode" label="Postcode" error={errorFor("postcode")}>
            <FormattedInput
              {...formattedBoxProps("postcode", formatPostcode)}
              inputMode="numeric"
              autoComplete="postal-code"
            />
          </Field>
        </div>
        {hasUnusualPostcode(values) ? (
          <p className="text-attention text-sm">
            That postcode does not usually belong to {values.state}. Check it; you can still save.
          </p>
        ) : null}
      </FormSection>

      <FormSection title="Contact">
        <Field name="phone" label="Phone" error={errorFor("phone")}>
          <FormattedInput
            {...formattedBoxProps("phone", formatAustralianPhone)}
            type="tel"
            autoComplete="tel"
            placeholder="0412 345 678"
          />
        </Field>
        <Field
          name="email"
          label="Email"
          hint="Renters' replies go here."
          error={errorFor("email")}
        >
          <Input {...textBoxProps("email")} type="email" autoComplete="email" />
        </Field>
        <Field
          name="timezone"
          label="Timezone"
          hint="Every date and time is shown in this zone."
          error={errorFor("timezone")}
        >
          <Select
            {...boxProps("timezone")}
            onChange={(event) => form.setValue("timezone", event.target.value)}
          >
            {AUSTRALIAN_TIMEZONES.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.label}
              </option>
            ))}
          </Select>
        </Field>
      </FormSection>

      {form.isResultShown && state.status === "failed" ? <FormError message={state.formError} /> : null}
      {form.isResultShown && !isPending && state.status === "saved" ? (
        <p
          className={state.hasPostcodeWarning ? "text-attention text-sm" : "text-teal text-sm"}
          role="status"
        >
          {state.hasPostcodeWarning ? POSTCODE_WARNING : "Saved."}
        </p>
      ) : null}
      <Button type="submit" disabled={isPending} className="sm:self-start">
        {isPending ? "Saving…" : "Save business details"}
      </Button>
    </form>
  );
}
