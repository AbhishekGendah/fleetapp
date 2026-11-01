"use client";

import { fieldErrorsOf } from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";

import { ChangeFormShell, useChangeForm } from "../../../components/change-form-shell";
import { cancelRentalInputSchema } from "../../../lib/rentals/rental-input";

const CANCEL_FIELDS = ["reason"] as const;

/** Why a draft or booking is cancelled: kept with the rental, never in the Log. */
export function CancelRentalForm(props: {
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
}) {
  const form = useChangeForm({
    action: props.action,
    fields: CANCEL_FIELDS,
    initialValues: { reason: "" },
    validate: (values) => fieldErrorsOf(cancelRentalInputSchema.safeParse(values)),
    isRequired: () => true,
  });
  const { fields } = form;
  return (
    <ChangeFormShell form={form} submitLabel="Cancel this rental">
      <FormField
        htmlFor={fields.idFor("reason")}
        label="Why is it cancelled?"
        isRequired
        hint="For your records. The car is let go for these dates."
        error={fields.errorFor("reason")}
      >
        <Input {...fields.textBoxProps("reason")} />
      </FormField>
    </ChangeFormShell>
  );
}
