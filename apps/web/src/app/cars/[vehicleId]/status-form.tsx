"use client";

import {
  fieldErrorsOf,
  needsReturnDate,
  VEHICLE_STATUS_LABELS,
  VEHICLE_STATUSES,
} from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import { Select } from "@fleetapp/ui/select";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import { useActionState } from "react";

import {
  vehicleStatusInputSchema,
  type VehicleStatusFormValues,
} from "../../../lib/vehicles/vehicle-input";
import { VEHICLE_FIELD_LABELS } from "../../../lib/vehicles/vehicle-labels";
import { INITIAL_CHANGE_STATE, type ChangeFormState } from "@fleetapp/ui/change-form-state";
import { FormResult } from "@fleetapp/ui/form-result";

const STATUS_FIELDS = ["status", "statusReason", "statusExpectedBack"] as const;

/** Changes the car's status. In service and off road ask why and until when. */
export function StatusForm(props: {
  initialValues: VehicleStatusFormValues;
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
}) {
  const [state, formAction, isPending] = useActionState(props.action, INITIAL_CHANGE_STATE);
  const form = useFormFields({
    fields: STATUS_FIELDS,
    initialValues: props.initialValues,
    validate: (values) => fieldErrorsOf(vehicleStatusInputSchema.safeParse(values)),
    isRequired: (field, values) => field === "status" || needsReturnDate(values.status),
  });
  const isAway = needsReturnDate(form.values.status);

  return (
    <form
      action={formAction}
      onSubmit={form.submitHandler(formAction)}
      noValidate
      className="flex flex-col gap-4"
    >
      <FormField htmlFor="status" label={VEHICLE_FIELD_LABELS.status} isRequired>
        <Select
          {...form.boxProps("status")}
          onChange={(event) => form.setValue("status", event.target.value)}
        >
          {VEHICLE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {VEHICLE_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </FormField>
      {isAway ? (
        <>
          <FormField
            htmlFor="statusReason"
            label={VEHICLE_FIELD_LABELS.statusReason}
            isRequired
            error={form.errorFor("statusReason")}
          >
            <Input {...form.textBoxProps("statusReason")} placeholder="e.g. Brakes and tyres" />
          </FormField>
          <FormField
            htmlFor="statusExpectedBack"
            label={VEHICLE_FIELD_LABELS.statusExpectedBack}
            isRequired
            error={form.errorFor("statusExpectedBack")}
          >
            <Input {...form.textBoxProps("statusExpectedBack")} type="date" />
          </FormField>
        </>
      ) : null}
      {form.isResultShown && !isPending ? <FormResult state={state} /> : null}
      <Button type="submit" variant="outline" disabled={isPending} className="sm:self-start">
        {isPending ? "Saving…" : "Save status"}
      </Button>
    </form>
  );
}
