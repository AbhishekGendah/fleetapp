"use client";

import { fieldErrorsOf, MAXIMUM_NOTE_LENGTH } from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { FormField } from "@fleetapp/ui/form-field";
import { Textarea } from "@fleetapp/ui/textarea";

import { ChangeFormShell, useChangeForm } from "../../../components/change-form-shell";
import { NOTE_FIELDS, noteInputSchema } from "../../../lib/renters/note-input";

/** Adds a dated note. Facts only: the Renter can ask to see what is written about them. */
export function NoteForm(props: {
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
}) {
  const changeForm = useChangeForm({
    action: props.action,
    fields: NOTE_FIELDS,
    initialValues: { body: "" },
    validate: (values) => fieldErrorsOf(noteInputSchema.safeParse(values)),
    isRequired: () => true,
    shouldClearOnSave: true,
  });
  const form = changeForm.fields;
  return (
    <ChangeFormShell form={changeForm} submitLabel="Add note">
      <FormField
        htmlFor="body"
        label="Note"
        isRequired
        hint="Write facts only: what happened and when. The Renter can ask to see this."
        error={form.errorFor("body")}
      >
        <Textarea
          {...form.boxProps("body")}
          onChange={(event) => form.setValue("body", event.target.value)}
          maxLength={MAXIMUM_NOTE_LENGTH}
          rows={4}
        />
      </FormField>
    </ChangeFormShell>
  );
}
