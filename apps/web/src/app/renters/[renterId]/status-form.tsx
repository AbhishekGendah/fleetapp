"use client";

import { fieldErrorsOf, RENTER_STATUS_LABELS, RENTER_STATUSES } from "@fleetapp/core";
import { INITIAL_CHANGE_STATE, type ChangeFormState } from "@fleetapp/ui/change-form-state";
import { FormField } from "@fleetapp/ui/form-field";
import { Select } from "@fleetapp/ui/select";
import { Input } from "@fleetapp/ui/input";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import { useActionState } from "react";

import { SaveStatusButton } from "../../../components/save-status-button";

import {
  RENTER_STATUS_FIELDS,
  renterStatusInputSchema,
  type RenterStatusFormValues,
} from "../../../lib/renters/renter-input";
import { RENTER_FIELD_LABELS } from "../../../lib/renters/renter-labels";

const DO_NOT_RENT = "do_not_rent";

/** Active, or Do not rent with the reason: private to the Operator, and facts only. */
export function RenterStatusForm(props: {
  initialValues: RenterStatusFormValues;
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
}) {
  const [state, formAction, isPending] = useActionState(props.action, INITIAL_CHANGE_STATE);
  const form = useFormFields({
    fields: RENTER_STATUS_FIELDS,
    initialValues: props.initialValues,
    validate: (values) => fieldErrorsOf(renterStatusInputSchema.safeParse(values)),
    isRequired: (field, values) => field === "status" || values.status === DO_NOT_RENT,
  });
  const isDoNotRent = form.values.status === DO_NOT_RENT;

  return (
    <form
      action={formAction}
      onSubmit={form.submitHandler(formAction)}
      noValidate
      className="flex flex-col gap-4"
    >
      <FormField htmlFor="status" label={RENTER_FIELD_LABELS.status} isRequired>
        <Select
          {...form.boxProps("status")}
          onChange={(event) => form.setValue("status", event.target.value)}
        >
          {RENTER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {RENTER_STATUS_LABELS[status]}
            </option>
          ))}
        </Select>
      </FormField>
      {isDoNotRent ? (
        <FormField
          htmlFor="doNotRentReason"
          label={RENTER_FIELD_LABELS.doNotRentReason}
          isRequired
          hint="Private to your business. Write facts only: the Renter can ask to see this."
          error={form.errorFor("doNotRentReason")}
        >
          <Input
            {...form.textBoxProps("doNotRentReason")}
            placeholder="e.g. Returned the car late three times"
          />
        </FormField>
      ) : null}
      <SaveStatusButton state={state} isPending={isPending} isResultShown={form.isResultShown} />
    </form>
  );
}
