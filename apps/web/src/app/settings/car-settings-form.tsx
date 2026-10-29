"use client";

import { fieldErrorsOf } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { FormField } from "@fleetapp/ui/form-field";
import { Input, RequiredFieldsNote } from "@fleetapp/ui/input";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import { useActionState } from "react";

import { INITIAL_CHANGE_STATE } from "../../components/change-form-state";
import { FormResult } from "../../components/form-result";
import { CAR_SETTINGS_FIELDS, carSettingsInputSchema } from "../../lib/settings/car-settings-input";
import { saveCarSettingsAction } from "./car-settings-actions";

/** Settings → Cars: when rego and insurance start showing "Due soon". */
export function CarSettingsForm({ warningDays }: { warningDays: number }) {
  const [state, formAction, isPending] = useActionState(
    saveCarSettingsAction,
    INITIAL_CHANGE_STATE,
  );
  const form = useFormFields({
    fields: CAR_SETTINGS_FIELDS,
    initialValues: { vehicleExpiryWarningDays: String(warningDays) },
    validate: (values) => fieldErrorsOf(carSettingsInputSchema.safeParse(values)),
    isRequired: () => true,
  });

  return (
    <form
      action={formAction}
      onSubmit={form.submitHandler(formAction)}
      noValidate
      className="flex flex-col gap-4"
    >
      <RequiredFieldsNote />
      <FormField
        htmlFor="vehicleExpiryWarningDays"
        label="Show “Due soon” this many days before rego or insurance expires"
        isRequired
        error={form.errorFor("vehicleExpiryWarningDays")}
      >
        <Input
          {...form.textBoxProps("vehicleExpiryWarningDays")}
          inputMode="numeric"
          className="sm:w-32"
        />
      </FormField>
      {form.isResultShown && !isPending ? <FormResult state={state} /> : null}
      <Button type="submit" variant="outline" disabled={isPending} className="sm:self-start">
        {isPending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
