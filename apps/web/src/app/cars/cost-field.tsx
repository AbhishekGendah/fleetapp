"use client";

import { FormField } from "@fleetapp/ui/form-field";
import type { FormFields } from "@fleetapp/ui/use-form-fields";

import { isRequiredCostField } from "../../lib/vehicles/cost-input";
import { vehicleFieldLabel } from "../../lib/vehicles/vehicle-labels";

/** One labelled box on the purchase, sale or cost form, with its asterisk and its problem. */
export function CostField<Field extends string>(props: {
  form: FormFields<Field>;
  field: Field;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <FormField
      htmlFor={props.field}
      label={vehicleFieldLabel(props.field)}
      isRequired={isRequiredCostField(props.field)}
      hint={props.hint}
      error={props.form.errorFor(props.field)}
    >
      {props.children}
    </FormField>
  );
}
