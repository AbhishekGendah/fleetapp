"use client";

import { fieldErrorsOf } from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";

import {
  STOP_DIRECT_DEBIT_FIELDS,
  stopDirectDebitInputSchema,
} from "../../../lib/vehicles/paperwork-input";
import { ChangeFormShell, useChangeForm } from "../../../components/change-form-shell";

/** When a rego direct debit stopped: today unless changed, e.g. to the day the car was sold. */
export function StopDirectDebitForm(props: {
  today: string;
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
}) {
  const changeForm = useChangeForm({
    action: props.action,
    fields: STOP_DIRECT_DEBIT_FIELDS,
    initialValues: { stoppedOn: props.today },
    validate: (values) => fieldErrorsOf(stopDirectDebitInputSchema.safeParse(values)),
    isRequired: () => true,
  });
  const form = changeForm.fields;
  return (
    <ChangeFormShell form={changeForm} submitLabel="Stop direct debit">
      <p className="text-muted-foreground text-sm">
        Cancel it in DoTDirect too. Adding a 3, 6, 9 or 12 month renewal stops it here by itself.
      </p>
      <FormField
        htmlFor="stoppedOn"
        label="Stopped on"
        isRequired
        error={form.errorFor("stoppedOn")}
      >
        <Input {...form.textBoxProps("stoppedOn")} type="date" />
      </FormField>
    </ChangeFormShell>
  );
}
