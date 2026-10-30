"use client";

import { fieldErrorsOf, REGO_TERMS_MONTHS } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { FormField } from "@fleetapp/ui/form-field";
import { Input, RequiredFieldsNote } from "@fleetapp/ui/input";
import { Select } from "@fleetapp/ui/select";
import { AustralianStateOptions } from "@fleetapp/ui/state-options";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import { useActionState } from "react";

import { INITIAL_CHANGE_STATE, type ChangeFormState } from "@fleetapp/ui/change-form-state";
import { FormResult } from "@fleetapp/ui/form-result";
import {
  isRequiredPaperworkField,
  parseRegoForm,
  REGO_FORM_FIELDS,
  type RegoFormValues,
} from "../../lib/vehicles/paperwork-input";
import { AmountWithGst } from "./amount-with-gst";

/** Records one rego renewal for a car. */
export function RegoForm(props: {
  initialValues: RegoFormValues;
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
}) {
  const [state, formAction, isPending] = useActionState(props.action, INITIAL_CHANGE_STATE);
  const form = useFormFields({
    fields: REGO_FORM_FIELDS,
    initialValues: props.initialValues,
    validate: (values) => fieldErrorsOf(parseRegoForm(values)),
    isRequired: isRequiredPaperworkField,
  });

  return (
    <form
      action={formAction}
      onSubmit={form.submitHandler(formAction)}
      noValidate
      className="flex flex-col gap-4"
    >
      <RequiredFieldsNote />
      <div className="grid grid-cols-2 gap-4">
        <FormField htmlFor="state" label="State" isRequired error={form.errorFor("state")}>
          <Select
            {...form.boxProps("state")}
            onChange={(event) => form.setValue("state", event.target.value)}
          >
            <AustralianStateOptions />
          </Select>
        </FormField>
        <FormField htmlFor="termMonths" label="Term" isRequired error={form.errorFor("termMonths")}>
          <Select
            {...form.boxProps("termMonths")}
            onChange={(event) => form.setValue("termMonths", event.target.value)}
          >
            <option value="">Choose…</option>
            {REGO_TERMS_MONTHS.map((months) => (
              <option key={months} value={String(months)}>
                {months} months
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          htmlFor="expiresOn"
          label="Expires"
          isRequired
          error={form.errorFor("expiresOn")}
        >
          <Input {...form.textBoxProps("expiresOn")} type="date" />
        </FormField>
        <FormField htmlFor="paidOn" label="Paid on" error={form.errorFor("paidOn")}>
          <Input {...form.textBoxProps("paidOn")} type="date" />
        </FormField>
      </div>
      <AmountWithGst
        form={form}
        amountField="costCents"
        gstField="gstCents"
        amountLabel="Cost"
        isGstUsuallyIncluded={false}
      />
      {form.isResultShown && !isPending ? <FormResult state={state} /> : null}
      <Button type="submit" disabled={isPending} className="sm:self-start">
        {isPending ? "Saving…" : "Add rego renewal"}
      </Button>
    </form>
  );
}
