"use client";

import {
  fieldErrorsOf,
  formatKilometresAsTyped,
  isPrivatePurchase,
  PURCHASE_SOURCE_LABELS,
  PURCHASE_SOURCES,
  type AustralianStateCode,
} from "@fleetapp/core";
import { FormattedInput } from "@fleetapp/ui/formatted-input";
import { Input } from "@fleetapp/ui/input";
import { Select } from "@fleetapp/ui/select";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";

import {
  isRequiredCostField,
  parsePurchaseForm,
  PURCHASE_FORM_FIELDS,
  type PurchaseFormValues,
} from "../../lib/vehicles/cost-input";
import { AmountWithGst } from "./amount-with-gst";
import { ChangeFormShell, useChangeForm } from "../../components/change-form-shell";
import { CostField } from "./cost-field";
import { PersonContactFields } from "./person-contact-fields";

/** How a car was bought: from whom, for how much, and the odometer then. */
export function PurchaseForm(props: {
  initialValues: PurchaseFormValues;
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
  isGstRegistered: boolean;
  nearState: AustralianStateCode | null;
  submitLabel: string;
}) {
  const form = useChangeForm({
    action: props.action,
    fields: PURCHASE_FORM_FIELDS,
    initialValues: props.initialValues,
    validate: (values) => fieldErrorsOf(parsePurchaseForm(values)),
    isRequired: isRequiredCostField,
  });
  const { fields } = form;

  return (
    <ChangeFormShell form={form} submitLabel={props.submitLabel}>
      <div className="grid grid-cols-2 gap-4">
        <CostField form={fields} field="purchasedOn">
          <Input {...fields.textBoxProps("purchasedOn")} type="date" />
        </CostField>
        <CostField form={fields} field="source">
          <Select
            {...fields.boxProps("source")}
            onChange={(event) => fields.setValue("source", event.target.value)}
          >
            <option value="">Choose…</option>
            {PURCHASE_SOURCES.map((source) => (
              <option key={source} value={source}>
                {PURCHASE_SOURCE_LABELS[source]}
              </option>
            ))}
          </Select>
        </CostField>
      </div>
      <PersonContactFields
        form={fields}
        nameField="sellerName"
        phoneField="sellerPhone"
        addressField="sellerAddress"
        nearState={props.nearState}
      />
      <CostField
        form={fields}
        field="kilometres"
        hint="What the odometer showed when you bought it."
      >
        <FormattedInput
          {...fields.formattedBoxProps("kilometres", formatKilometresAsTyped)}
          inputMode="numeric"
        />
      </CostField>
      <AmountWithGst
        form={fields}
        amountField="priceCents"
        gstField="gstCents"
        amountLabel="Price"
        gstSource="tenth_of_amount"
        isGstRegistered={props.isGstRegistered}
        isGstAllowed={!isPrivatePurchase(fields.values.source)}
      />
    </ChangeFormShell>
  );
}
