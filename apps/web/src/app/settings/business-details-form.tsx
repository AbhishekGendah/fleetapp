"use client";

import { AUSTRALIAN_STATE_CODES, AUSTRALIAN_TIMEZONES, formatAbn } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { FormError } from "@fleetapp/ui/form-message";
import { Input, Label } from "@fleetapp/ui/input";
import { Select } from "@fleetapp/ui/select";
import { useActionState, useState } from "react";

import type { BusinessDetails } from "../../lib/settings/business-details";
import { saveBusinessDetailsAction } from "./actions";
import type {
  BusinessDetailsFormState,
  BusinessDetailTextField,
} from "./business-details-form-state";

const INITIAL_STATE: BusinessDetailsFormState = { status: "editing" };

const POSTCODE_WARNING =
  "Saved. That postcode does not usually belong to that state: check it is right.";

/** What each field starts with: what was just typed after a refusal, otherwise what is saved. */
function startingValues(
  details: BusinessDetails,
  state: BusinessDetailsFormState,
): Record<BusinessDetailTextField, string> {
  if (state.status === "invalid" || state.status === "failed") {
    return state.values as Record<BusinessDetailTextField, string>;
  }
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
    phone: details.phone ?? "",
    email: details.email ?? "",
    timezone: details.timezone,
  };
}

interface FieldProps {
  name: BusinessDetailTextField;
  label: string;
  values: Record<BusinessDetailTextField, string>;
  errors?: Partial<Record<string, string[]>>;
  hint?: string;
  children?: React.ReactNode;
  inputProps?: React.ComponentPropsWithoutRef<"input">;
}

function Field(props: FieldProps) {
  const errors = props.errors?.[props.name];
  const describedBy = errors ? `${props.name}-error` : undefined;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={props.name}>{props.label}</Label>
      {props.children ?? (
        <Input
          id={props.name}
          name={props.name}
          defaultValue={props.values[props.name]}
          aria-invalid={errors ? true : undefined}
          aria-describedby={describedBy}
          {...props.inputProps}
        />
      )}
      {props.hint ? <p className="text-muted-foreground text-xs">{props.hint}</p> : null}
      {errors ? (
        <p id={describedBy} className="text-destructive text-sm">
          {errors.join(" ")}
        </p>
      ) : null}
    </div>
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

export function BusinessDetailsForm({ details }: { details: BusinessDetails }) {
  const [state, formAction, isPending] = useActionState(saveBusinessDetailsAction, INITIAL_STATE);
  const values = startingValues(details, state);
  const errors = state.status === "invalid" ? state.fieldErrors : undefined;
  const [isGstRegistered, setIsGstRegistered] = useState(
    state.status === "invalid" || state.status === "failed"
      ? state.isGstRegistered
      : details.gstRegistered,
  );
  const fieldProps = { values, errors };

  return (
    <form action={formAction} className="flex flex-col gap-8">
      <Section title="Your business">
        <Field
          {...fieldProps}
          name="legalName"
          label="Legal name"
          inputProps={{ required: true }}
        />
        <Field
          {...fieldProps}
          name="tradingName"
          label="Trading name (optional)"
          hint="Shown to Renters instead of the legal name, if given."
        />
        <Field
          {...fieldProps}
          name="abn"
          label="ABN"
          inputProps={{ inputMode: "numeric", placeholder: "51 824 753 556" }}
        />
      </Section>

      <Section title="GST">
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="gstRegistered"
            className="size-5"
            checked={isGstRegistered}
            onChange={(event) => setIsGstRegistered(event.target.checked)}
          />
          This business is registered for GST
        </label>
        {isGstRegistered ? (
          <Field
            {...fieldProps}
            name="gstRegisteredFrom"
            label="Registered from"
            inputProps={{ type: "date" }}
          />
        ) : null}
      </Section>

      <Section title="Address">
        <Field
          {...fieldProps}
          name="addressLine1"
          label="Street address"
          inputProps={{ autoComplete: "address-line1" }}
        />
        <Field
          {...fieldProps}
          name="addressLine2"
          label="Address line 2 (optional)"
          inputProps={{ autoComplete: "address-line2" }}
        />
        <Field
          {...fieldProps}
          name="suburb"
          label="Suburb"
          inputProps={{ autoComplete: "address-level2" }}
        />
        <div className="grid grid-cols-2 gap-4">
          <Field {...fieldProps} name="state" label="State">
            <Select id="state" name="state" defaultValue={values.state}>
              <option value="">Choose…</option>
              {AUSTRALIAN_STATE_CODES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            {...fieldProps}
            name="postcode"
            label="Postcode"
            inputProps={{ inputMode: "numeric", maxLength: 4, autoComplete: "postal-code" }}
          />
        </div>
      </Section>

      <Section title="Contact">
        <Field
          {...fieldProps}
          name="phone"
          label="Phone"
          inputProps={{ type: "tel", autoComplete: "tel" }}
        />
        <Field
          {...fieldProps}
          name="email"
          label="Email"
          hint="Renters' replies go here."
          inputProps={{ type: "email", autoComplete: "email" }}
        />
        <Field
          {...fieldProps}
          name="timezone"
          label="Timezone"
          hint="Every date and time is shown in this zone."
        >
          <Select id="timezone" name="timezone" defaultValue={values.timezone}>
            {AUSTRALIAN_TIMEZONES.map((zone) => (
              <option key={zone.id} value={zone.id}>
                {zone.label}
              </option>
            ))}
          </Select>
        </Field>
      </Section>

      {state.status === "failed" ? <FormError message={state.formError ?? null} /> : null}
      {state.status === "saved" ? (
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
