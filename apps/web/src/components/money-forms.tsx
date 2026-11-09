"use client";

import {
  fieldErrorsOf,
  MANUAL_PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  requiredLine,
} from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import { MoneyInput } from "@fleetapp/ui/money-input";
import { Select } from "@fleetapp/ui/select";
import { z } from "zod";

import {
  MANUAL_PAYMENT_FIELDS,
  manualPaymentInputSchema,
  REQUIRED_MANUAL_PAYMENT_FIELDS,
  type ManualPaymentField,
} from "../lib/money/manual-payment-input";
import { ChangeFormShell, useChangeForm } from "./change-form-shell";

type ChangeAction = (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;

/** Money received by bank transfer or cash (a bond, a rent payment). */
export function ManualPaymentForm(props: {
  action: ChangeAction;
  today: string;
  initialValues: Record<ManualPaymentField, string>;
  submitLabel: string;
  /** Said before saving, e.g. a debit already on its way (slice 5). */
  warning?: string;
}) {
  const form = useChangeForm({
    action: props.action,
    fields: MANUAL_PAYMENT_FIELDS,
    initialValues: props.initialValues,
    validate: (values) => fieldErrorsOf(manualPaymentInputSchema(props.today).safeParse(values)),
    isRequired: (field) => REQUIRED_MANUAL_PAYMENT_FIELDS.has(field),
  });
  const { fields } = form;
  return (
    <ChangeFormShell form={form} submitLabel={props.submitLabel}>
      {props.warning ? <p className="text-sm font-medium">{props.warning}</p> : null}
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

const CORRECTION_FIELDS = ["note"] as const;
const correctionSchema = z.object({ note: requiredLine });

/** Why an entry is corrected: it is undone exactly, and the reason kept with it. */
export function CorrectionForm(props: {
  action: ChangeAction;
  label: string;
  hint: string;
  submitLabel: string;
}) {
  const form = useChangeForm({
    action: props.action,
    fields: CORRECTION_FIELDS,
    initialValues: { note: "" },
    validate: (values) => fieldErrorsOf(correctionSchema.safeParse(values)),
    isRequired: () => true,
  });
  const { fields } = form;
  return (
    <ChangeFormShell form={form} submitLabel={props.submitLabel}>
      <FormField
        htmlFor={fields.idFor("note")}
        label={props.label}
        isRequired
        hint={props.hint}
        error={fields.errorFor("note")}
      >
        <Input {...fields.textBoxProps("note")} />
      </FormField>
    </ChangeFormShell>
  );
}
