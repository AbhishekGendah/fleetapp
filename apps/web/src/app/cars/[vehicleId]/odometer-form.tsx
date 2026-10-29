"use client";

import { MAXIMUM_LINE_LENGTH } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import { useActionState } from "react";
import { z } from "zod";

import { odometerInputSchema } from "../../../lib/vehicles/vehicle-input";
import { CAR_PAGE_INITIAL_STATE, type CarPageFormState } from "./car-page-state";
import { FormResult } from "./form-result";

const ODOMETER_FIELDS = ["kilometres"] as const;

/** Records what the odometer shows now. */
export function OdometerForm(props: {
  action: (state: CarPageFormState, formData: FormData) => Promise<CarPageFormState>;
}) {
  const [state, formAction, isPending] = useActionState(props.action, CAR_PAGE_INITIAL_STATE);
  const form = useFormFields({
    fields: ODOMETER_FIELDS,
    initialValues: { kilometres: "" },
    validate: (values) => {
      const parsed = odometerInputSchema.safeParse(values);
      return parsed.success ? {} : z.flattenError(parsed.error).fieldErrors;
    },
    isRequired: () => true,
    maxLength: MAXIMUM_LINE_LENGTH,
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
