"use client";

import { fieldErrorsOf, GST_TREATMENT_LABELS, GST_TREATMENTS } from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import { Select } from "@fleetapp/ui/select";
import type { FormFields } from "@fleetapp/ui/use-form-fields";

import { ChangeFormShell, useChangeForm } from "../../../components/change-form-shell";
import {
  CHARGE_TYPE_FIELDS,
  chargeTypeInputSchema,
  GST_TREATMENT_FIELDS,
  gstTreatmentInputSchema,
} from "../../../lib/ledger/ledger-input";

type ChangeAction = (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
const alwaysRequired = (): boolean => true;

function GstTreatmentField({ fields }: { fields: FormFields<"gstTreatment"> }) {
  return (
    <FormField
      htmlFor={fields.idFor("gstTreatment")}
      label="GST"
      isRequired
      hint="Applies to charges added from now on; ones already added keep theirs."
      error={fields.errorFor("gstTreatment")}
    >
      <Select
        {...fields.boxProps("gstTreatment")}
        onChange={(event) => fields.setValue("gstTreatment", event.target.value)}
      >
        {GST_TREATMENTS.map((treatment) => (
          <option key={treatment} value={treatment}>
            {GST_TREATMENT_LABELS[treatment]}
          </option>
        ))}
      </Select>
    </FormField>
  );
}

/** One of the business's own charge types: its name and GST. Also used to add one. */
export function ChargeTypeForm(props: {
  action: ChangeAction;
  initialValues: { name: string; gstTreatment: string };
  submitLabel: string;
}) {
  const form = useChangeForm({
    action: props.action,
    fields: CHARGE_TYPE_FIELDS,
    initialValues: props.initialValues,
    validate: (values) => fieldErrorsOf(chargeTypeInputSchema.safeParse(values)),
    isRequired: alwaysRequired,
  });
  const { fields } = form;
  return (
    <ChangeFormShell form={form} submitLabel={props.submitLabel}>
      <FormField
        htmlFor={fields.idFor("name")}
        label="Name"
        isRequired
        error={fields.errorFor("name")}
      >
        <Input {...fields.textBoxProps("name")} placeholder="e.g. Fuel top-up" />
      </FormField>
      <GstTreatmentField fields={fields} />
    </ChangeFormShell>
  );
}

/** A built-in type's GST only: its name comes from the app. */
export function GstTreatmentForm(props: { action: ChangeAction; gstTreatment: string }) {
  const form = useChangeForm({
    action: props.action,
    fields: GST_TREATMENT_FIELDS,
    initialValues: { gstTreatment: props.gstTreatment },
    validate: (values) => fieldErrorsOf(gstTreatmentInputSchema.safeParse(values)),
    isRequired: alwaysRequired,
  });
  return (
    <ChangeFormShell form={form} submitLabel="Save GST">
      <GstTreatmentField fields={form.fields} />
    </ChangeFormShell>
  );
}
