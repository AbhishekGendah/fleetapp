"use client";

import {
  AUSTRALIAN_STATE_CODES,
  AUSTRALIAN_TIMEZONES,
  formatAbn,
  formatAustralianPhone,
  formatPostcode,
  isRequiredBusinessDetail,
  isAustralianStateCode,
  POSTCODE_PATTERN,
  postcodeMatchesState,
  stateForTimezone,
  type AustralianStateCode,
} from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { FormError } from "@fleetapp/ui/form-message";
import { FormattedInput } from "@fleetapp/ui/formatted-input";
import { fieldErrorId, FormField } from "@fleetapp/ui/form-field";
import { Input, RequiredFieldsNote } from "@fleetapp/ui/input";
import { Select } from "@fleetapp/ui/select";
import { startTransition, useActionState, useMemo, useState } from "react";
import { z } from "zod";

import { AddressSearch } from "../../components/address-search";
import type { AddressParts } from "../../lib/address-lookup/address-from-components";
import type { BusinessDetails } from "../../lib/settings/business-details";
import {
  MAXIMUM_TEXT_LENGTH,
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

/** The boxes a looked-up address fills in. Address line 2 is left as typed. */
const ADDRESS_FIELDS = [
  "addressLine1",
  "suburb",
  "state",
  "postcode",
] as const satisfies readonly (keyof AddressParts)[];

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

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="text-primary mb-1 text-base font-semibold">{props.title}</legend>
      {props.children}
    </fieldset>
  );
}

/**
 * Each box is checked once you leave it, then again with every key, using the
 * same rules the server applies on save. Nothing is shown for a box you have
 * not reached yet, so an empty form does not open covered in red.
 */
export function BusinessDetailsForm({ details }: { details: BusinessDetails }) {
  const [state, formAction, isPending] = useActionState(saveBusinessDetailsAction, INITIAL_STATE);
  const [values, setValues] = useState(() => savedValues(details));
  const [isGstRegistered, setIsGstRegistered] = useState(details.gstRegistered);
  const [checkedFields, setCheckedFields] = useState<ReadonlySet<BusinessDetailTextField>>(
    () => new Set(),
  );
  const [isResultShown, setIsResultShown] = useState(false);

  const errors = useMemo(() => {
    const parsed = parseBusinessDetailsForm(values, isGstRegistered);
    return parsed.success ? {} : z.flattenError(parsed.error).fieldErrors;
  }, [values, isGstRegistered]);

  function errorFor(name: BusinessDetailTextField): string | undefined {
    return checkedFields.has(name) ? errors[name]?.[0] : undefined;
  }

  function handleValueChange(name: BusinessDetailTextField, value: string): void {
    setValues((previous) => ({ ...previous, [name]: value }));
    setIsResultShown(false);
  }

  function handleAddressChosen(address: AddressParts): void {
    setValues((previous) => ({ ...previous, ...address }));
    setCheckedFields((previous) => new Set([...previous, ...ADDRESS_FIELDS]));
    setIsResultShown(false);
  }

  function handleBlur(name: BusinessDetailTextField): void {
    setCheckedFields((previous) => new Set(previous).add(name));
  }

  /** What every box shares: its name, its value, and its error wired up for screen readers. */
  function boxProps(name: BusinessDetailTextField) {
    const error = errorFor(name);
    return {
      id: name,
      name,
      value: values[name],
      onBlur: () => handleBlur(name),
      "aria-required": isRequiredField(name) ? true : undefined,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": error ? fieldErrorId(name) : undefined,
    };
  }

  function textBoxProps(name: BusinessDetailTextField) {
    return {
      ...boxProps(name),
      maxLength: MAXIMUM_TEXT_LENGTH,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
        handleValueChange(name, event.target.value),
    };
  }

  function formattedBoxProps(name: BusinessDetailTextField, format: (raw: string) => string) {
    return {
      ...boxProps(name),
      format,
      onValueChange: (value: string) => handleValueChange(name, value),
    };
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setCheckedFields(new Set(BUSINESS_DETAIL_TEXT_FIELDS));
    const firstProblem = BUSINESS_DETAIL_TEXT_FIELDS.find((name) => errors[name]);
    if (firstProblem) {
      document.getElementById(firstProblem)?.focus();
      return;
    }
    const formData = new FormData(event.currentTarget);
    setIsResultShown(true);
    startTransition(() => formAction(formData));
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate className="flex flex-col gap-8">
      <RequiredFieldsNote />
      <Section title="Your business">
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
      </Section>

      <Section title="GST">
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="gstRegistered"
            className="size-5"
            checked={isGstRegistered}
            onChange={(event) => {
              setIsGstRegistered(event.target.checked);
              setIsResultShown(false);
            }}
          />
          This business is registered for GST
        </label>
        {isGstRegistered ? (
          <Field
            name="gstRegisteredFrom"
            label="Registered from"
            error={errorFor("gstRegisteredFrom")}
          >
            <Input {...textBoxProps("gstRegisteredFrom")} type="date" />
          </Field>
        ) : null}
      </Section>

      <Section title="Address">
        <Field name="addressLine1" label="Street address" error={errorFor("addressLine1")}>
          <AddressSearch
            {...boxProps("addressLine1")}
            maxLength={MAXIMUM_TEXT_LENGTH}
            placeholder="Start typing to search"
            onValueChange={(value) => handleValueChange("addressLine1", value)}
            onAddressChosen={handleAddressChosen}
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
              onChange={(event) => handleValueChange("state", event.target.value)}
            >
              <option value="">Choose…</option>
              {AUSTRALIAN_STATE_CODES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
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
      </Section>

      <Section title="Contact">
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
            onChange={(event) => handleValueChange("timezone", event.target.value)}
          >
            {AUSTRALIAN_TIMEZONES.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.label}
              </option>
            ))}
          </Select>
        </Field>
      </Section>

      {isResultShown && state.status === "failed" ? <FormError message={state.formError} /> : null}
      {isResultShown && !isPending && state.status === "saved" ? (
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
