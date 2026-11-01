"use client";

import {
  fieldErrorsOf,
  MERGE_FIELD_GROUP_LABELS,
  MERGE_FIELDS,
  type TemplateDocument,
} from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { ContractEditor, type EditorMergeField } from "@fleetapp/ui/contract-editor";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";

import { ChangeFormShell, useChangeForm } from "../../../../components/change-form-shell";
import {
  TEMPLATE_EDIT_FIELDS,
  templateEditInputSchema,
} from "../../../../lib/contracts/template-input";

const EDITOR_FIELDS: readonly EditorMergeField[] = MERGE_FIELDS.map((field) => ({
  key: field.key,
  label: field.label,
  groupLabel: MERGE_FIELD_GROUP_LABELS[field.group],
}));

/** A template's name and text. Saving a changed text makes the next version. */
export function TemplateEditorForm(props: {
  name: string;
  content: TemplateDocument;
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
}) {
  const form = useChangeForm({
    action: props.action,
    fields: TEMPLATE_EDIT_FIELDS,
    initialValues: { name: props.name, content: JSON.stringify(props.content) },
    validate: (values) => fieldErrorsOf(templateEditInputSchema.safeParse(values)),
    isRequired: () => true,
  });
  const { fields } = form;
  return (
    <ChangeFormShell form={form} submitLabel="Save">
      <FormField
        htmlFor={fields.idFor("name")}
        label="Name"
        isRequired
        error={fields.errorFor("name")}
      >
        <Input {...fields.textBoxProps("name")} />
      </FormField>
      <FormField
        htmlFor={fields.idFor("content")}
        label="Contract text"
        isRequired
        hint="Use Insert field for the rental's details: they are filled in for each rental."
        error={fields.errorFor("content")}
      >
        <ContractEditor
          id={fields.idFor("content")}
          name="content"
          initialContent={props.content}
          onValueChange={(json) => fields.setValue("content", json)}
          fields={EDITOR_FIELDS}
        />
      </FormField>
    </ChangeFormShell>
  );
}
