"use client";

import { fieldErrorsOf } from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import { RecordPicker, type PickableRecord } from "@fleetapp/ui/record-picker";

import { ChangeFormShell, useChangeForm } from "../../../components/change-form-shell";
import { START_SWAP_FIELDS, startSwapFormSchema } from "../../../lib/rentals/swap-input";

const alwaysRequired = (): boolean => true;

/** Choosing the car the Renter swaps into, and why: then the old car's checklist opens. */
export function StartSwapForm(props: {
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
  cars: PickableRecord[];
}) {
  const form = useChangeForm({
    action: props.action,
    fields: START_SWAP_FIELDS,
    initialValues: { toVehicleId: "", reason: "" },
    validate: (values) => fieldErrorsOf(startSwapFormSchema.safeParse(values)),
    isRequired: alwaysRequired,
    idPrefix: "swap-",
  });
  const { fields } = form;
  return (
    <ChangeFormShell form={form} submitLabel="Start the swap">
      <FormField
        htmlFor={fields.idFor("toVehicleId")}
        label="New car"
        isRequired
        hint="Only Available cars are listed."
        error={fields.errorFor("toVehicleId")}
      >
        <RecordPicker
          {...fields.boxProps("toVehicleId")}
          records={props.cars}
          onValueChange={(value) => fields.setValue("toVehicleId", value)}
          placeholder="Type a rego, make or model"
          emptyMessage="No available car matches that."
        />
      </FormField>
      <FormField
        htmlFor={fields.idFor("reason")}
        label="Reason"
        isRequired
        hint="Kept with the swap, and shown on the form the Renter signs."
        error={fields.errorFor("reason")}
      >
        <Input {...fields.textBoxProps("reason")} placeholder="e.g. Engine light on" />
      </FormField>
    </ChangeFormShell>
  );
}
