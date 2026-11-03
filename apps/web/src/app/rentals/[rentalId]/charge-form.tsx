"use client";

import { fieldErrorsOf } from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import { MoneyInput } from "@fleetapp/ui/money-input";
import { Select } from "@fleetapp/ui/select";

import { ChangeFormShell, useChangeForm } from "../../../components/change-form-shell";
import {
  CHARGE_FIELDS,
  chargeInputSchema,
  type ChargeField,
} from "../../../lib/ledger/ledger-input";

const alwaysRequired = (): boolean => true;

/** A one-off charge: what for (its type sets the GST), how much, what the Renter reads, and the day. */
export function ChargeForm(props: {
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
  chargeTypes: readonly { id: string; label: string }[];
  initialValues: Record<ChargeField, string>;
}) {
  const form = useChangeForm({
    action: props.action,
    fields: CHARGE_FIELDS,
    initialValues: props.initialValues,
    validate: (values) => fieldErrorsOf(chargeInputSchema.safeParse(values)),
    isRequired: alwaysRequired,
    shouldClearOnSave: true,
  });
  const { fields } = form;
  return (
    <ChangeFormShell form={form} submitLabel="Add charge">
      <FormField
        htmlFor={fields.idFor("chargeTypeId")}
        label="What for"
        isRequired
        hint="Its GST is set in Settings → Charges."
        error={fields.errorFor("chargeTypeId")}
      >
        <Select
          {...fields.boxProps("chargeTypeId")}
          onChange={(event) => fields.setValue("chargeTypeId", event.target.value)}
        >
          <option value="">Choose…</option>
          {props.chargeTypes.map((type) => (
            <option key={type.id} value={type.id}>
              {type.label}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        htmlFor={fields.idFor("amountCents")}
        label="Amount"
        isRequired
        hint="Including GST, if any."
        error={fields.errorFor("amountCents")}
      >
        <MoneyInput
          {...fields.boxProps("amountCents")}
          onValueChange={(value) => fields.setValue("amountCents", value)}
        />
      </FormField>
      <FormField
        htmlFor={fields.idFor("description")}
        label="Description"
        isRequired
        hint="What the Renter will read on their statement."
        error={fields.errorFor("description")}
      >
        <Input {...fields.textBoxProps("description")} placeholder="e.g. Interior cleaning" />
      </FormField>
      <FormField
        htmlFor={fields.idFor("effectiveOn")}
        label="Date"
        isRequired
        error={fields.errorFor("effectiveOn")}
      >
        <Input {...fields.textBoxProps("effectiveOn")} type="date" />
      </FormField>
    </ChangeFormShell>
  );
}
