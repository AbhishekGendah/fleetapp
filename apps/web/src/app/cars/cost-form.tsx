"use client";

import { fieldErrorsOf, VEHICLE_COST_KIND_LABELS, VEHICLE_COST_KINDS } from "@fleetapp/core";
import { Input } from "@fleetapp/ui/input";
import { Select } from "@fleetapp/ui/select";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";

import {
  COST_FORM_FIELDS,
  emptyCostForm,
  isRequiredCostField,
  parseCostForm,
} from "../../lib/vehicles/cost-input";
import { AmountWithGst } from "./amount-with-gst";
import { ChangeFormShell, useChangeForm } from "./change-form-shell";
import { CostField } from "./cost-field";

/** One other cost of a car: a refurb, a repair or anything else. */
export function CostForm(props: {
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
  isGstRegistered: boolean;
}) {
  const form = useChangeForm({
    action: props.action,
    fields: COST_FORM_FIELDS,
    initialValues: emptyCostForm(),
    validate: (values) => fieldErrorsOf(parseCostForm(values)),
    isRequired: isRequiredCostField,
  });
  const { fields } = form;

  return (
    <ChangeFormShell form={form} submitLabel="Add cost">
      <div className="grid grid-cols-2 gap-4">
        <CostField form={fields} field="incurredOn">
          <Input {...fields.textBoxProps("incurredOn")} type="date" />
        </CostField>
        <CostField form={fields} field="kind" hint="Refurb counts towards what the car cost you.">
          <Select
            {...fields.boxProps("kind")}
            onChange={(event) => fields.setValue("kind", event.target.value)}
          >
            <option value="">Choose…</option>
            {VEHICLE_COST_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {VEHICLE_COST_KIND_LABELS[kind]}
              </option>
            ))}
          </Select>
        </CostField>
      </div>
      <CostField form={fields} field="description">
        <Input {...fields.textBoxProps("description")} placeholder="e.g. New tyres" />
      </CostField>
      <AmountWithGst
        form={fields}
        amountField="costCents"
        gstField="gstCents"
        amountLabel="Amount"
        gstSource="tenth_of_amount"
        isGstRegistered={props.isGstRegistered}
      />
    </ChangeFormShell>
  );
}
