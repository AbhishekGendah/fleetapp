"use client";

import { fieldErrorsOf, needsReturnDate, STATUS_BOX_STATUSES } from "@fleetapp/core";
import { RequiredFieldsNote } from "@fleetapp/ui/input";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import { useActionState } from "react";

import { SaveStatusButton } from "../../../components/save-status-button";

import {
  vehicleStatusInputSchema,
  type VehicleStatusFormValues,
} from "../../../lib/vehicles/vehicle-input";
import { INITIAL_CHANGE_STATE, type ChangeFormState } from "@fleetapp/ui/change-form-state";
import { CarStatusFields } from "./car-status-fields";

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

  return (
    <form
      action={formAction}
      onSubmit={form.submitHandler(formAction)}
      noValidate
      className="flex flex-col gap-4"
    >
      <RequiredFieldsNote />
      <CarStatusFields form={form} statuses={STATUS_BOX_STATUSES} />
      <SaveStatusButton state={state} isPending={isPending} isResultShown={form.isResultShown} />
    </form>
  );
}
