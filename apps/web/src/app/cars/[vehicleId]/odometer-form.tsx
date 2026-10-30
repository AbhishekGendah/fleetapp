"use client";

import { fieldErrorsOf, formatKilometresAsTyped } from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { Checkbox } from "@fleetapp/ui/checkbox";
import { FormField } from "@fleetapp/ui/form-field";
import { FormattedInput } from "@fleetapp/ui/formatted-input";

import { ODOMETER_REPLACED_FIELD, odometerInputSchema } from "../../../lib/vehicles/vehicle-input";
import { ChangeFormShell, useChangeForm } from "../change-form-shell";

const ODOMETER_FIELDS = ["kilometres"] as const;

/** Records what the odometer shows now. */
export function OdometerForm(props: {
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
}) {
  const changeForm = useChangeForm({
    action: props.action,
    fields: ODOMETER_FIELDS,
    initialValues: { kilometres: "" },
    validate: (values) =>
      fieldErrorsOf(odometerInputSchema.safeParse({ ...values, isOdometerReplaced: false })),
    isRequired: () => true,
    shouldClearOnSave: true,
  });
  const form = changeForm.fields;

  return (
    <ChangeFormShell form={changeForm} submitLabel="Save reading">
      <FormField
        htmlFor="kilometres"
        label="Odometer now (km)"
        isRequired
        error={form.errorFor("kilometres")}
      >
        <FormattedInput
          {...form.formattedBoxProps("kilometres", formatKilometresAsTyped)}
          inputMode="numeric"
        />
      </FormField>
      <Checkbox
        name={ODOMETER_REPLACED_FIELD}
        label="The odometer was replaced (allows a reading lower than the last)"
        onChange={form.markChanged}
      />
    </ChangeFormShell>
  );
}
