"use client";

import { fieldErrorsOf, MANUAL_PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import { MoneyInput } from "@fleetapp/ui/money-input";
import { Select } from "@fleetapp/ui/select";

import { ChangeFormShell, useChangeForm } from "../../../components/change-form-shell";
import {
  BOND_RECEIVED_FIELDS,
  BOND_REVERSAL_FIELDS,
  bondReceivedInputSchema,
  bondReversalInputSchema,
  REQUIRED_BOND_RECEIVED_FIELDS,
  type BondReceivedField,
} from "../../../lib/bonds/bond-input";

type ChangeAction = (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;

/** Bond received by bank transfer or cash; starts with the rest of the bond, today. */
export function BondReceivedForm(props: {
  action: ChangeAction;
  today: string;
  initialValues: Record<BondReceivedField, string>;
}) {
  const form = useChangeForm({
    action: props.action,
    fields: BOND_RECEIVED_FIELDS,
    initialValues: props.initialValues,
    validate: (values) => fieldErrorsOf(bondReceivedInputSchema(props.today).safeParse(values)),
    isRequired: (field) => REQUIRED_BOND_RECEIVED_FIELDS.has(field),
  });
  const { fields } = form;
  return (
    <ChangeFormShell form={form} submitLabel="Record bond">
      <FormField
        htmlFor={fields.idFor("amountCents")}
        label="Amount"
        isRequired
        error={fields.errorFor("amountCents")}
      >
        <MoneyInput
          {...fields.boxProps("amountCents")}
          onValueChange={(value) => fields.setValue("amountCents", value)}
        />
      </FormField>
      <FormField
        htmlFor={fields.idFor("method")}
        label="How"
        isRequired
        error={fields.errorFor("method")}
      >
        <Select
          {...fields.boxProps("method")}
          onChange={(event) => fields.setValue("method", event.target.value)}
        >
          {MANUAL_PAYMENT_METHODS.map((method) => (
            <option key={method} value={method}>
              {PAYMENT_METHOD_LABELS[method]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        htmlFor={fields.idFor("occurredOn")}
        label="Received on"
        isRequired
        error={fields.errorFor("occurredOn")}
      >
        <Input {...fields.textBoxProps("occurredOn")} type="date" max={props.today} />
      </FormField>
      <FormField
        htmlFor={fields.idFor("reference")}
        label="Reference"
        hint="The bank transfer's reference or your receipt number."
        error={fields.errorFor("reference")}
      >
        <Input
          {...fields.textBoxProps("reference")}
          onChange={(event) => fields.setValue("reference", event.target.value.toUpperCase())}
          autoCapitalize="characters"
        />
      </FormField>
    </ChangeFormShell>
  );
}

/** Why an entry is corrected: it is undone exactly, and the reason kept with the bond. */
export function BondReversalForm(props: { action: ChangeAction }) {
  const form = useChangeForm({
    action: props.action,
    fields: BOND_REVERSAL_FIELDS,
    initialValues: { note: "" },
    validate: (values) => fieldErrorsOf(bondReversalInputSchema.safeParse(values)),
    isRequired: () => true,
  });
  const { fields } = form;
  return (
    <ChangeFormShell form={form} submitLabel="Correct this entry">
      <FormField
        htmlFor={fields.idFor("note")}
        label="Why is it being corrected?"
        isRequired
        hint="E.g. entered twice, or the wrong amount. The entry stays in the list, cancelled out."
        error={fields.errorFor("note")}
      >
        <Input {...fields.textBoxProps("note")} />
      </FormField>
    </ChangeFormShell>
  );
}
