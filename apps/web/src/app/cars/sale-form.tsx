"use client";

import { fieldErrorsOf, normaliseLicenceNumber, type AustralianStateCode } from "@fleetapp/core";
import { Input } from "@fleetapp/ui/input";
import { FormSection } from "@fleetapp/ui/form-section";
import { Select } from "@fleetapp/ui/select";
import { AustralianStateOptions } from "@fleetapp/ui/state-options";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";

import {
  isRequiredCostField,
  parseSaleForm,
  SALE_FORM_FIELDS,
  type SaleFormValues,
} from "../../lib/vehicles/cost-input";
import { AmountWithGst } from "./amount-with-gst";
import { ChangeFormShell, useChangeForm } from "./change-form-shell";
import { CostField } from "./cost-field";
import { PersonContactFields } from "./person-contact-fields";

/**
 * A car's sale: when it was handed over, to whom, and the transfer. The
 * buyer's details are kept so a fine after the sale can be passed on.
 */
export function SaleForm(props: {
  initialValues: SaleFormValues;
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
  isGstRegistered: boolean;
  timeZone: string;
  nearState: AustralianStateCode | null;
  submitLabel: string;
}) {
  const form = useChangeForm({
    action: props.action,
    fields: SALE_FORM_FIELDS,
    initialValues: props.initialValues,
    validate: (values) => fieldErrorsOf(parseSaleForm(values, props.timeZone)),
    isRequired: isRequiredCostField,
  });
  const { fields } = form;

  return (
    <ChangeFormShell form={form} submitLabel={props.submitLabel}>
      <FormSection title="The sale">
        <CostField
          form={fields}
          field="soldAt"
          hint="On your clock. A fine that day may fall either side of it."
        >
          <Input {...fields.textBoxProps("soldAt")} type="datetime-local" />
        </CostField>
        <AmountWithGst
          form={fields}
          amountField="priceCents"
          gstField="gstCents"
          amountLabel="Price"
          gstSource="tenth_of_amount"
          isGstRegistered={props.isGstRegistered}
        />
      </FormSection>
      <FormSection title="The buyer">
        <PersonContactFields
          form={fields}
          nameField="buyerName"
          phoneField="buyerPhone"
          addressField="buyerAddress"
          nearState={props.nearState}
        />
        <div className="grid grid-cols-[1fr_7rem] gap-4">
          <CostField form={fields} field="buyerLicenceNumber">
            <Input
              {...fields.textBoxProps("buyerLicenceNumber")}
              onChange={(event) =>
                fields.setValue("buyerLicenceNumber", normaliseLicenceNumber(event.target.value))
              }
              autoCapitalize="characters"
              autoComplete="off"
            />
          </CostField>
          <CostField form={fields} field="buyerLicenceState">
            <Select
              {...fields.boxProps("buyerLicenceState")}
              onChange={(event) => fields.setValue("buyerLicenceState", event.target.value)}
            >
              <AustralianStateOptions />
            </Select>
          </CostField>
        </div>
      </FormSection>
      <FormSection title="The transfer">
        <p className="text-muted-foreground text-sm">
          Until the transfer is lodged with the transport department, fines can still come to you.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <CostField form={fields} field="transferLodgedOn">
            <Input {...fields.textBoxProps("transferLodgedOn")} type="date" />
          </CostField>
          <CostField form={fields} field="transferReference">
            <Input
              {...fields.textBoxProps("transferReference")}
              onChange={(event) =>
                fields.setValue("transferReference", event.target.value.toUpperCase())
              }
              autoCapitalize="characters"
              autoComplete="off"
            />
          </CostField>
        </div>
      </FormSection>
    </ChangeFormShell>
  );
}
