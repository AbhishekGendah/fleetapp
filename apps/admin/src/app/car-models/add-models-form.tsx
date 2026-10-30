"use client";

import { fieldErrorsOf } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { INITIAL_CHANGE_STATE, type ChangeFormState } from "@fleetapp/ui/change-form-state";
import { FormField } from "@fleetapp/ui/form-field";
import { FormResult } from "@fleetapp/ui/form-result";
import { Textarea } from "@fleetapp/ui/textarea";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import { useActionState } from "react";

import { ADD_MODELS_FIELDS, addModelsInputSchema } from "../../lib/car-models/car-model-input";

/** Adds one model, or a whole range pasted one per line. */
export function AddModelsForm(props: {
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
}) {
  const [state, formAction, isPending] = useActionState(props.action, INITIAL_CHANGE_STATE);
  const form = useFormFields({
    fields: ADD_MODELS_FIELDS,
    initialValues: { names: "" },
    validate: (values) => fieldErrorsOf(addModelsInputSchema.safeParse(values)),
    isRequired: () => true,
  });

  return (
    <form
      action={formAction}
      onSubmit={form.submitHandler(formAction)}
      noValidate
      className="flex max-w-md flex-col gap-4"
    >
      <FormField
        htmlFor="names"
        label="Models to add, one per line"
        isRequired
        hint="Any already listed, however they are spelt, are skipped."
        error={form.errorFor("names")}
      >
        <Textarea
          {...form.boxProps("names")}
          onChange={(event) => form.setValue("names", event.target.value)}
        />
      </FormField>
      {form.isResultShown && !isPending ? <FormResult state={state} /> : null}
      <Button type="submit" variant="outline" disabled={isPending} className="sm:self-start">
        {isPending ? "Adding…" : "Add models"}
      </Button>
    </form>
  );
}
