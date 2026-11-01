"use client";

import {
  CONTRACT_TEMPLATE_KIND_LABELS,
  CONTRACT_TEMPLATE_KINDS,
  fieldErrorsOf,
} from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import { Select } from "@fleetapp/ui/select";

import { ChangeFormShell, useChangeForm } from "../../../components/change-form-shell";
import { NEW_TEMPLATE_FIELDS, newTemplateInputSchema } from "../../../lib/contracts/template-input";

/** A new template: its kind and name. It opens in the editor with the starter layout. */
export function AddTemplateForm(props: {
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
}) {
  const form = useChangeForm({
    action: props.action,
    fields: NEW_TEMPLATE_FIELDS,
    initialValues: { kind: "contract", name: "" },
    validate: (values) => fieldErrorsOf(newTemplateInputSchema.safeParse(values)),
    isRequired: () => true,
  });
  const { fields } = form;
  return (
    <ChangeFormShell form={form} submitLabel="Add template">
      <FormField
        htmlFor={fields.idFor("kind")}
        label="Kind"
        isRequired
        error={fields.errorFor("kind")}
      >
        <Select
          {...fields.boxProps("kind")}
          onChange={(event) => fields.setValue("kind", event.target.value)}
        >
          {CONTRACT_TEMPLATE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {CONTRACT_TEMPLATE_KIND_LABELS[kind]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        htmlFor={fields.idFor("name")}
        label="Name"
        isRequired
        hint="For you only, e.g. Standard or Rideshare."
        error={fields.errorFor("name")}
      >
        <Input {...fields.textBoxProps("name")} />
      </FormField>
    </ChangeFormShell>
  );
}
