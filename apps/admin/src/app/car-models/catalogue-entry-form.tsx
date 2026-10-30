"use client";

import { fieldErrorsOf } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { INITIAL_CHANGE_STATE, type ChangeFormState } from "@fleetapp/ui/change-form-state";
import { FormField } from "@fleetapp/ui/form-field";
import { FormResult } from "@fleetapp/ui/form-result";
import { Input, RequiredFieldsNote } from "@fleetapp/ui/input";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import { useActionState } from "react";

import {
  CATALOGUE_ENTRY_FIELDS,
  catalogueEntryInputSchema,
  type CatalogueEntryField,
} from "../../lib/car-models/car-model-input";

/** A make's or model's name and the other names people type for it. */
export function CatalogueEntryForm(props: {
  nameLabel: string;
  initialValues: Record<CatalogueEntryField, string>;
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
  submitLabel: string;
}) {
  const [state, formAction, isPending] = useActionState(props.action, INITIAL_CHANGE_STATE);
  const form = useFormFields({
    fields: CATALOGUE_ENTRY_FIELDS,
    initialValues: props.initialValues,
    validate: (values) => fieldErrorsOf(catalogueEntryInputSchema.safeParse(values)),
    isRequired: (field) => field === "name",
  });

  return (
    <form
      action={formAction}
      onSubmit={form.submitHandler(formAction)}
      noValidate
      className="flex max-w-md flex-col gap-4"
    >
      <RequiredFieldsNote />
      <FormField htmlFor="name" label={props.nameLabel} isRequired error={form.errorFor("name")}>
        <Input {...form.textBoxProps("name")} />
      </FormField>
      <FormField
        htmlFor="aliases"
        label="Also known as"
        hint="Other names people type, separated by commas, e.g. Merc, Benz. Spacing and capitals are ignored anyway."
        error={form.errorFor("aliases")}
      >
        <Input {...form.textBoxProps("aliases")} />
      </FormField>
      {form.isResultShown && !isPending ? <FormResult state={state} /> : null}
      <Button type="submit" disabled={isPending} className="sm:self-start">
        {isPending ? "Saving…" : props.submitLabel}
      </Button>
    </form>
  );
}
