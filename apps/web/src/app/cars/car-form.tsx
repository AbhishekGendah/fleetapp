"use client";

import {
  BODY_TYPE_LABELS,
  BODY_TYPES,
  fieldErrorsOf,
  FUEL_TYPE_LABELS,
  FUEL_TYPES,
  listedName,
  MAXIMUM_LINE_LENGTH,
  MAXIMUM_REGO_LENGTH,
  modelsForMake,
  TRANSMISSION_LABELS,
  TRANSMISSIONS,
  VEHICLE_MAKES,
} from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { ComboBox } from "@fleetapp/ui/combo-box";
import { FormError } from "@fleetapp/ui/form-message";
import { FormField } from "@fleetapp/ui/form-field";
import { FormSection } from "@fleetapp/ui/form-section";
import { Input, RequiredFieldsNote } from "@fleetapp/ui/input";
import { Select } from "@fleetapp/ui/select";
import { AustralianStateOptions } from "@fleetapp/ui/state-options";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import Link from "next/link";
import { useActionState } from "react";

import {
  isRequiredVehicleField,
  NEW_VEHICLE_FORM_FIELDS,
  parseNewVehicleForm,
  parseVehicleForm,
  typedRego,
  VEHICLE_FORM_FIELDS,
  type VehicleFormField,
  type VehicleFormValues,
} from "../../lib/vehicles/vehicle-input";
import { VEHICLE_FIELD_LABELS } from "../../lib/vehicles/vehicle-labels";
import type { CarFormState } from "./car-form-state";

const INITIAL_STATE: CarFormState = { status: "editing" };

const NOT_LISTED_WARNING = "Not in our list. Check the spelling; you can still save it.";

const DUPLICATE_MESSAGES = {
  rego: "You already have a car with this rego in this state.",
  vin: "You already have a car with this VIN.",
} as const;

interface CarFormProps {
  /** Adding a car also asks for its odometer reading; editing does not. */
  isNew: boolean;
  initialValues: VehicleFormValues;
  action: (state: CarFormState, formData: FormData) => Promise<CarFormState>;
  submitLabel: string;
  cancelHref: string;
}

function ChoiceOptions(props: {
  values: readonly string[];
  labels: Readonly<Record<string, string>>;
}) {
  return (
    <>
      <option value="">Not set</option>
      {props.values.map((value) => (
        <option key={value} value={value}>
          {props.labels[value]}
        </option>
      ))}
    </>
  );
}

/**
 * Adding or editing a car. Make and model suggest from the built-in list as
 * you type; anything not listed can still be typed, with a gentle warning in
 * case it is a misspelling.
 */
export function CarForm({ isNew, initialValues, action, submitLabel, cancelHref }: CarFormProps) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);
  const form = useFormFields({
    fields: isNew ? NEW_VEHICLE_FORM_FIELDS : VEHICLE_FORM_FIELDS,
    initialValues,
    validate: (values) =>
      fieldErrorsOf(
        isNew ? parseNewVehicleForm(values, new Date()) : parseVehicleForm(values, new Date()),
      ),
    isRequired: isRequiredVehicleField,
  });
  // A refusal stops applying as soon as anything is changed.
  const shownState = form.isResultShown && !isPending ? state : INITIAL_STATE;
  const { values, errorFor, boxProps, textBoxProps } = form;
  const models = modelsForMake(values.make);
  const isMakeListed = listedName(VEHICLE_MAKES, values.make) !== null;

  function warningFor(field: "make" | "model"): string | undefined {
    const typed = values[field].trim();
    if (!typed) {
      return undefined;
    }
    if (field === "make") {
      return isMakeListed ? undefined : NOT_LISTED_WARNING;
    }
    // A make not in the list has no models to compare against.
    return isMakeListed && listedName(models, typed) === null ? NOT_LISTED_WARNING : undefined;
  }

  function duplicateErrorFor(field: VehicleFormField): string | undefined {
    return shownState.status === "duplicate" && shownState.field === field
      ? DUPLICATE_MESSAGES[field]
      : undefined;
  }

  function fieldProps(field: VehicleFormField) {
    return {
      htmlFor: field,
      label: VEHICLE_FIELD_LABELS[field],
      isRequired: isRequiredVehicleField(field),
      error: errorFor(field) ?? duplicateErrorFor(field),
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
      <FormSection title="The car">
        <div className="grid grid-cols-[1fr_7rem] gap-4">
          <FormField {...fieldProps("rego")}>
            <Input
              {...textBoxProps("rego")}
              maxLength={MAXIMUM_REGO_LENGTH}
              onChange={(event) => form.setValue("rego", typedRego(event.target.value))}
              autoCapitalize="characters"
              placeholder="1ABC234"
            />
          </FormField>
          <FormField {...fieldProps("regoState")}>
            <Select
              {...boxProps("regoState")}
              onChange={(event) => form.setValue("regoState", event.target.value)}
            >
              <AustralianStateOptions />
            </Select>
          </FormField>
        </div>
        {shownState.status === "duplicate" && shownState.existingCarHref ? (
          <Link
            href={shownState.existingCarHref}
            className="text-teal text-sm font-semibold hover:underline"
          >
            Open the car you already have →
          </Link>
        ) : null}
        <FormField {...fieldProps("make")} warning={warningFor("make")}>
          <ComboBox
            {...boxProps("make")}
            maxLength={MAXIMUM_LINE_LENGTH}
            options={VEHICLE_MAKES}
            onValueChange={(value) => form.setValue("make", value)}
            placeholder="Start typing, e.g. Toyota"
          />
        </FormField>
        <FormField {...fieldProps("model")} warning={warningFor("model")}>
          <ComboBox
            {...boxProps("model")}
            maxLength={MAXIMUM_LINE_LENGTH}
            options={models}
            onValueChange={(value) => form.setValue("model", value)}
            placeholder={isMakeListed ? "Start typing, or choose" : undefined}
          />
        </FormField>
        <FormField {...fieldProps("variant")} hint="The badge or trim, e.g. Ascent Sport Hybrid.">
          <Input {...textBoxProps("variant")} />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField {...fieldProps("year")}>
            <Input {...textBoxProps("year")} inputMode="numeric" />
          </FormField>
          <FormField {...fieldProps("colour")}>
            <Input {...textBoxProps("colour")} />
          </FormField>
        </div>
        {isNew ? (
          <FormField {...fieldProps("kilometres")} hint="What the odometer shows today.">
            <Input {...textBoxProps("kilometres")} inputMode="numeric" />
          </FormField>
        ) : null}
      </FormSection>

      <FormSection title="More details">
        <div className="grid grid-cols-2 gap-4">
          <FormField {...fieldProps("bodyType")}>
            <Select
              {...boxProps("bodyType")}
              onChange={(event) => form.setValue("bodyType", event.target.value)}
            >
              <ChoiceOptions values={BODY_TYPES} labels={BODY_TYPE_LABELS} />
            </Select>
          </FormField>
          <FormField {...fieldProps("seats")}>
            <Input {...textBoxProps("seats")} inputMode="numeric" />
          </FormField>
          <FormField {...fieldProps("transmission")}>
            <Select
              {...boxProps("transmission")}
              onChange={(event) => form.setValue("transmission", event.target.value)}
            >
              <ChoiceOptions values={TRANSMISSIONS} labels={TRANSMISSION_LABELS} />
            </Select>
          </FormField>
          <FormField {...fieldProps("fuelType")}>
            <Select
              {...boxProps("fuelType")}
              onChange={(event) => form.setValue("fuelType", event.target.value)}
            >
              <ChoiceOptions values={FUEL_TYPES} labels={FUEL_TYPE_LABELS} />
            </Select>
          </FormField>
        </div>
        <FormField
          {...fieldProps("vin")}
          hint="17 characters, on the rego papers or the windscreen."
        >
          <Input {...textBoxProps("vin")} autoCapitalize="characters" />
        </FormField>
      </FormSection>

      {shownState.status === "failed" ? <FormError message={shownState.formError} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : submitLabel}
        </Button>
        <Button asChild variant="ghost">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
