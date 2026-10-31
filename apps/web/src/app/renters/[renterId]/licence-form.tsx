"use client";

import { fieldErrorsOf } from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";

import { ChangeFormShell, useChangeForm } from "../../../components/change-form-shell";
import {
  LICENCE_FORM_FIELDS,
  parseLicenceForm,
  type LicenceFormValues,
} from "../../../lib/renters/licence-input";
import { LicenceFields } from "./licence-fields";

/** The Renter's licence, as on the card. One per Renter: a renewed licence is an edit. */
export function LicenceForm(props: {
  initialValues: LicenceFormValues;
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
  submitLabel: string;
}) {
  const changeForm = useChangeForm({
    action: props.action,
    fields: LICENCE_FORM_FIELDS,
    initialValues: props.initialValues,
    validate: (values) => fieldErrorsOf(parseLicenceForm(values)),
    // The country box only shows for an overseas licence, where it is needed.
    isRequired: () => true,
  });

  return (
    <ChangeFormShell form={changeForm} submitLabel={props.submitLabel}>
      <LicenceFields form={changeForm.fields} />
    </ChangeFormShell>
  );
}
