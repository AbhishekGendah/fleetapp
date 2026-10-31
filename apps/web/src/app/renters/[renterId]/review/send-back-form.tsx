"use client";

import { fieldErrorsOf, MAXIMUM_NOTE_LENGTH } from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { FormField } from "@fleetapp/ui/form-field";
import { Textarea } from "@fleetapp/ui/textarea";

import { ChangeFormShell, useChangeForm } from "../../../../components/change-form-shell";
import { SEND_BACK_FIELDS, sendBackInputSchema } from "../../../../lib/renter-links/review-input";

/** The note the Renter sees on their link and in the email: what to change. */
export function SendBackForm(props: {
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
}) {
  const changeForm = useChangeForm({
    action: props.action,
    fields: SEND_BACK_FIELDS,
    initialValues: { note: "" },
    validate: (values) => fieldErrorsOf(sendBackInputSchema.safeParse(values)),
    isRequired: () => true,
  });
  const form = changeForm.fields;
  return (
    <ChangeFormShell form={changeForm} submitLabel="Send back">
      <FormField
        htmlFor="note"
        label="What should they change?"
        isRequired
        hint="The Renter sees this on their link and in an email, e.g. “The back photo is blurry, please retake it.”"
        error={form.errorFor("note")}
      >
        <Textarea
          {...form.boxProps("note")}
          onChange={(event) => form.setValue("note", event.target.value)}
          maxLength={MAXIMUM_NOTE_LENGTH}
          rows={4}
        />
      </FormField>
    </ChangeFormShell>
  );
}
