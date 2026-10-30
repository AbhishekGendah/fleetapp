"use client";

import { Button } from "@fleetapp/ui/button";
import { INITIAL_CHANGE_STATE, type ChangeFormState } from "@fleetapp/ui/change-form-state";
import { useDialogClose } from "@fleetapp/ui/form-dialog";
import { FormResult } from "@fleetapp/ui/form-result";
import { RequiredFieldsNote } from "@fleetapp/ui/input";
import { useFormFields, type FieldErrors, type FormFields } from "@fleetapp/ui/use-form-fields";
import { useActionState } from "react";

type ChangeAction = (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;

interface ChangeFormOptions<Field extends string> {
  action: ChangeAction;
  fields: readonly Field[];
  initialValues: Readonly<Record<Field, string>>;
  validate: (values: Readonly<Record<Field, string>>) => FieldErrors<Field>;
  isRequired: (field: Field) => boolean;
  /** For a form that adds a record: empty it once saved, so it cannot add the same one twice. */
  shouldClearOnSave?: boolean;
}

export interface ChangeForm<Field extends string> {
  fields: FormFields<Field>;
  state: ChangeFormState;
  formAction: (formData: FormData) => void;
  isPending: boolean;
}

/** A small form on a car's page that saves through a server action and shows its answer. */
export function useChangeForm<Field extends string>(
  options: ChangeFormOptions<Field>,
): ChangeForm<Field> {
  const closeDialog = useDialogClose();
  const fields = useFormFields({
    fields: options.fields,
    initialValues: options.initialValues,
    validate: options.validate,
    isRequired: (field) => options.isRequired(field),
  });
  const [state, formAction, isPending] = useActionState(
    async (previous: ChangeFormState, formData: FormData) => {
      const result = await options.action(previous, formData);
      if (result.status !== "saved") {
        return result;
      }
      // In a pop-up, a plain save closes it; a warning stays up to be read.
      if (closeDialog && !result.isWarning) {
        closeDialog();
      } else if (options.shouldClearOnSave) {
        fields.clear();
      }
      return result;
    },
    INITIAL_CHANGE_STATE,
  );
  return { fields, state, formAction, isPending };
}

/** The frame those forms share: required note, the answer, and the save button. */
export function ChangeFormShell<Field extends string>(props: {
  form: ChangeForm<Field>;
  submitLabel: string;
  children: React.ReactNode;
}) {
  const { fields, state, formAction, isPending } = props.form;
  return (
    <form
      action={formAction}
      onSubmit={fields.submitHandler(formAction)}
      noValidate
      className="flex flex-col gap-4"
    >
      <RequiredFieldsNote />
      {props.children}
      {fields.isResultShown && !isPending ? <FormResult state={state} /> : null}
      <Button type="submit" disabled={isPending} className="sm:self-start">
        {isPending ? "Saving…" : props.submitLabel}
      </Button>
    </form>
  );
}
