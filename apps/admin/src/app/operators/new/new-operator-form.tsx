"use client";

import { fieldErrorsOf } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { FormField } from "@fleetapp/ui/form-field";
import { FormError } from "@fleetapp/ui/form-message";
import { Input, RequiredFieldsNote } from "@fleetapp/ui/input";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import { useActionState } from "react";

import {
  CREATE_OPERATOR_FIELDS,
  createOperatorInputSchema,
  isRequiredCreateOperatorField,
  type CreateOperatorField,
} from "../../../lib/operators/operator-input";
import { createOperatorAction, type ActionState } from "../actions";

const INITIAL_STATE: ActionState = {};

const EMPTY_FORM: Record<CreateOperatorField, string> = {
  legalName: "",
  tradingName: "",
  userFullName: "",
  userEmail: "",
};

const FIELD_LABELS: Readonly<Record<CreateOperatorField, string>> = {
  legalName: "Legal business name",
  tradingName: "Trading name",
  userFullName: "Their full name",
  userEmail: "Their email address",
};

const FIELD_HINTS: Partial<Record<CreateOperatorField, string>> = {
  tradingName: "Used in emails instead of the legal name, if given.",
};

/** Checked as you type with the same rules the server applies (rule 28). */
export function NewOperatorForm() {
  const [state, formAction, isPending] = useActionState(createOperatorAction, INITIAL_STATE);
  const form = useFormFields({
    fields: CREATE_OPERATOR_FIELDS,
    initialValues: EMPTY_FORM,
    validate: (values) => fieldErrorsOf(createOperatorInputSchema.safeParse(values)),
    isRequired: isRequiredCreateOperatorField,
  });
  const shownState = form.isResultShown && !isPending ? state : INITIAL_STATE;

  return (
    <form
      action={formAction}
      onSubmit={form.submitHandler(formAction)}
      noValidate
      className="flex max-w-md flex-col gap-4"
    >
      <RequiredFieldsNote />
      {CREATE_OPERATOR_FIELDS.map((field) => (
        <FormField
          key={field}
          htmlFor={field}
          label={FIELD_LABELS[field]}
          isRequired={isRequiredCreateOperatorField(field)}
          hint={FIELD_HINTS[field]}
          error={form.errorFor(field) ?? shownState.fieldErrors?.[field]?.[0]}
        >
          <Input
            {...form.textBoxProps(field)}
            type={field === "userEmail" ? "email" : "text"}
            autoComplete="off"
          />
        </FormField>
      ))}

      <FormError message={shownState.formError ?? null} />

      <Button type="submit" disabled={isPending}>
        {isPending ? "Creating…" : "Create and send invite"}
      </Button>
    </form>
  );
}
