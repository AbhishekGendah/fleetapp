"use client";

import { fieldErrorsOf } from "@fleetapp/core";
import { FormField } from "@fleetapp/ui/form-field";
import { Textarea } from "@fleetapp/ui/textarea";

import { ChangeFormShell, useChangeForm } from "../../components/change-form-shell";
import { PHOTO_LIST_FIELDS, photoListInputSchema } from "../../lib/settings/photo-list-input";
import { saveHandoverPhotosAction } from "./photo-list-actions";

/** The photos every handover asks for, one per line, in order. */
export function PhotoListForm({ photos }: { photos: readonly string[] }) {
  const form = useChangeForm({
    action: saveHandoverPhotosAction,
    fields: PHOTO_LIST_FIELDS,
    initialValues: { photos: photos.join("\n") },
    validate: (values) => fieldErrorsOf(photoListInputSchema.safeParse(values)),
    isRequired: () => true,
  });
  const { fields } = form;
  return (
    <ChangeFormShell form={form} submitLabel="Save photo list">
      <FormField
        htmlFor={fields.idFor("photos")}
        label="Photos taken at each handover (one per line)"
        isRequired
        hint="In the order they are taken, e.g. Front, Rear, Left side."
        error={fields.errorFor("photos")}
      >
        <Textarea
          {...fields.boxProps("photos")}
          onChange={(event) => fields.setValue("photos", event.target.value)}
          rows={8}
        />
      </FormField>
    </ChangeFormShell>
  );
}
