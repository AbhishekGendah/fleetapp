"use client";

import { fieldErrorsOf } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import { useActionState } from "react";

import { odometerInputSchema } from "../../../lib/vehicles/vehicle-input";
import { INITIAL_CHANGE_STATE, type ChangeFormState } from "../../../components/change-form-state";
import { FormResult } from "../../../components/form-result";

const ODOMETER_FIELDS = ["kilometres"] as const;

/** Records what the odometer shows now. */
export function OdometerForm(props: {
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
}) {
  const [state, formAction, isPending] = useActionState(props.action, INITIAL_CHANGE_STATE);
  const form = useFormFields({
    fields: ODOMETER_FIELDS,
    initialValues: { kilometres: "" },
    validate: (values) => fieldErrorsOf(odometerInputSchema.safeParse(values)),
    isRequired: () => true,
  });

  return (
    <form
      action={formAction}
      onSubmit={form.submitHandler(formAction)}
      noValidate
      className="flex flex-col gap-4"
    >
      <FormField
        htmlFor="kilometres"
        label="Odometer now (km)"
        isRequired
        error={form.errorFor("kilometres")}
      >
        <Input {...form.textBoxProps("kilometres")} inputMode="numeric" />
      </FormField>
      {form.isResultShown && !isPending ? <FormResult state={state} /> : null}
      <Button type="submit" variant="outline" disabled={isPending} className="sm:self-start">
        {isPending ? "Saving…" : "Save reading"}
      </Button>
    </form>
  );
}
