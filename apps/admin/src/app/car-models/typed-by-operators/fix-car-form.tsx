"use client";

import {
  catalogueModels,
  fieldErrorsOf,
  inCatalogueSpelling,
  type VehicleCatalogue,
} from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { INITIAL_CHANGE_STATE, type ChangeFormState } from "@fleetapp/ui/change-form-state";
import { ComboBox } from "@fleetapp/ui/combo-box";
import { FormField } from "@fleetapp/ui/form-field";
import { FormResult } from "@fleetapp/ui/form-result";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import { useActionState, useId } from "react";

import {
  ADD_AND_FIX_INTENT,
  CAR_NAME_FIELDS,
  carNameInputSchema,
  FIX_INTENT_FIELD,
} from "../../../lib/car-models/car-model-input";

/**
 * One Operator's car with a make or model not in the list: choose what it
 * should be, then fix just this car, or add that to the list and fix it.
 * Starts on the list's spelling where what was typed already matches.
 */
export function FixCarForm(props: {
  typed: { make: string; model: string };
  catalogue: VehicleCatalogue;
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
}) {
  const idPrefix = useId();
  const [state, formAction, isPending] = useActionState(props.action, INITIAL_CHANGE_STATE);
  const form = useFormFields({
    fields: CAR_NAME_FIELDS,
    initialValues: inCatalogueSpelling(props.catalogue, props.typed),
    validate: (values) => fieldErrorsOf(carNameInputSchema.safeParse(values)),
    isRequired: () => true,
  });
  const makeId = `${idPrefix}-make`;
  const modelId = `${idPrefix}-model`;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField htmlFor={makeId} label="Make" isRequired error={form.errorFor("make")}>
          <ComboBox
            {...form.boxProps("make")}
            id={makeId}
            options={props.catalogue}
            onValueChange={(value) => form.setValue("make", value)}
          />
        </FormField>
        <FormField htmlFor={modelId} label="Model" isRequired error={form.errorFor("model")}>
          <ComboBox
            {...form.boxProps("model")}
            id={modelId}
            options={catalogueModels(props.catalogue, form.values.make)}
            onValueChange={(value) => form.setValue("model", value)}
          />
        </FormField>
      </div>
      <FormResult state={isPending ? INITIAL_CHANGE_STATE : state} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="outline" disabled={isPending}>
          Fix this car
        </Button>
        <Button
          type="submit"
          name={FIX_INTENT_FIELD}
          value={ADD_AND_FIX_INTENT}
          disabled={isPending}
        >
          Add to list and fix
        </Button>
      </div>
    </form>
  );
}
