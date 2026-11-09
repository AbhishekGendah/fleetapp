"use client";

import { fieldErrorsOf, MAXIMUM_NOTE_LENGTH } from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { ChoiceCards } from "@fleetapp/ui/choice-cards";
import { FormField } from "@fleetapp/ui/form-field";
import { Textarea } from "@fleetapp/ui/textarea";
import Link from "next/link";

import { ChangeFormShell, useChangeForm } from "../../../../components/change-form-shell";
import { renterDriversPath } from "../../../../lib/paths";
import type { DriverChoice } from "../../../../lib/rentals/driver-choices";
import {
  START_DRIVER_CHANGE_FIELDS,
  startDriverChangeFormSchema,
} from "../../../../lib/rentals/driver-change-input";
import { driverChoiceCard } from "../../driver-picker";

const alwaysRequired = (): boolean => true;

/**
 * A driver change's first step (mockup 7): who drives the car next (the
 * business's other current drivers, each with their licence and standing;
 * one who can't take a car yet is shown but can't be picked), and why. Then
 * the car's check-in opens.
 */
export function StartDriverChangeForm(props: {
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
  carRego: string;
  businessId: string;
  businessName: string;
  drivers: readonly DriverChoice[];
}) {
  const form = useChangeForm({
    action: props.action,
    fields: START_DRIVER_CHANGE_FIELDS,
    initialValues: { toDriverId: "", reason: "" },
    validate: (values) => fieldErrorsOf(startDriverChangeFormSchema.safeParse(values)),
    isRequired: alwaysRequired,
    idPrefix: "driver-change-",
  });
  const { fields } = form;
  return (
    <ChangeFormShell form={form} submitLabel="Next: check the car in">
      <div className="flex flex-col gap-2">
        <ChoiceCards
          id={fields.idFor("toDriverId")}
          name="toDriverId"
          label={`Who drives ${props.carRego} next?`}
          options={props.drivers.map(driverChoiceCard)}
          value={fields.values.toDriverId}
          onValueChange={(value) => fields.setValue("toDriverId", value)}
          isRequired
          hint={`${props.businessName}'s other drivers. The new driver signs for the car at the last step.`}
          error={fields.errorFor("toDriverId")}
          layout="stack"
        />
        <Link
          href={renterDriversPath(props.businessId)}
          className="text-teal hover:text-primary flex min-h-11 items-center self-start text-sm font-bold"
        >
          + Add a driver to {props.businessName}
        </Link>
      </div>
      <FormField
        htmlFor={fields.idFor("reason")}
        label="Why the change"
        isRequired
        hint="Kept with the change and printed on both reports. Not written into the Log."
        error={fields.errorFor("reason")}
      >
        <Textarea
          {...fields.boxProps("reason")}
          onChange={(event) => fields.setValue("reason", event.target.value)}
          maxLength={MAXIMUM_NOTE_LENGTH}
          rows={3}
        />
      </FormField>
    </ChangeFormShell>
  );
}
