"use client";

import {
  fieldErrorsOf,
  HOW_TO_PAY_MAX_LENGTH,
  MAXIMUM_DOCUMENT_NUMBER,
  NUMBER_PREFIX_MAX_LENGTH,
} from "@fleetapp/core";
import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import { Textarea } from "@fleetapp/ui/textarea";

import { ChangeFormShell, useChangeForm } from "../../../components/change-form-shell";
import { HOW_TO_PAY_FIELDS, howToPayInputSchema } from "../../../lib/billing/how-to-pay-input";
import { NUMBERING_FIELDS, numberingInputSchema } from "../../../lib/billing/numbering-input";

type ChangeAction = (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;

const NUMBER_DIGITS = String(MAXIMUM_DOCUMENT_NUMBER).length;

/** A series' prefix and next number; the number is fixed once the first document is issued. */
export function NumberingForm(props: {
  action: ChangeAction;
  idPrefix: string;
  prefix: string;
  nextNumber: number;
  isStarted: boolean;
}) {
  const form = useChangeForm({
    action: props.action,
    fields: NUMBERING_FIELDS,
    initialValues: { prefix: props.prefix, nextNumber: String(props.nextNumber) },
    validate: (values) => fieldErrorsOf(numberingInputSchema.safeParse(values)),
    isRequired: (field) => field === "nextNumber",
    idPrefix: props.idPrefix,
  });
  const { fields } = form;
  return (
    <ChangeFormShell form={form} submitLabel="Save numbering">
      <FormField
        htmlFor={fields.idFor("prefix")}
        label="Prefix"
        hint="Printed before the number, e.g. INV- makes INV-1001."
        error={fields.errorFor("prefix")}
      >
        <Input
          {...fields.textBoxProps("prefix")}
          onChange={(event) => fields.setValue("prefix", event.target.value.toUpperCase())}
          autoCapitalize="characters"
          maxLength={NUMBER_PREFIX_MAX_LENGTH}
          className="sm:max-w-40"
        />
      </FormField>
      <FormField
        htmlFor={fields.idFor("nextNumber")}
        label="Next number"
        isRequired
        hint={
          props.isStarted
            ? "Fixed now the first has been issued: numbers run on with no gaps."
            : "Set it before the first is issued, e.g. to carry on from your old system."
        }
        error={fields.errorFor("nextNumber")}
      >
        <Input
          {...fields.textBoxProps("nextNumber")}
          onChange={(event) =>
            fields.setValue(
              "nextNumber",
              event.target.value.replace(/\D/g, "").slice(0, NUMBER_DIGITS),
            )
          }
          inputMode="numeric"
          readOnly={props.isStarted}
          className="sm:max-w-40"
        />
      </FormField>
    </ChangeFormShell>
  );
}

/** What every invoice says about paying. */
export function HowToPayForm(props: { action: ChangeAction; howToPay: string }) {
  const form = useChangeForm({
    action: props.action,
    fields: HOW_TO_PAY_FIELDS,
    initialValues: { howToPay: props.howToPay },
    validate: (values) => fieldErrorsOf(howToPayInputSchema.safeParse(values)),
    isRequired: () => false,
  });
  const { fields } = form;
  return (
    <ChangeFormShell form={form} submitLabel="Save how to pay">
      <FormField
        htmlFor={fields.idFor("howToPay")}
        label="How to pay"
        hint="Printed under every invoice, e.g. your bank's name, BSB and account number for a transfer, and the reference to use. Check the numbers: a mistake goes out on every invoice."
        error={fields.errorFor("howToPay")}
      >
        <Textarea
          {...fields.boxProps("howToPay")}
          onChange={(event) => fields.setValue("howToPay", event.target.value)}
          rows={5}
          maxLength={HOW_TO_PAY_MAX_LENGTH}
        />
      </FormField>
    </ChangeFormShell>
  );
}
