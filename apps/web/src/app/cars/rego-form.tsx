"use client";

import {
  addMonths,
  fieldErrorsOf,
  isDirectDebitTerm,
  REGO_TERMS_MONTHS,
  regoTermLabel,
} from "@fleetapp/core";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import { Select } from "@fleetapp/ui/select";
import { AustralianStateOptions } from "@fleetapp/ui/state-options";
import { useState } from "react";

import type { ChangeFormState } from "@fleetapp/ui/change-form-state";
import {
  isRequiredPaperworkField,
  parseRegoForm,
  REGO_FORM_FIELDS,
  type RegoFormValues,
} from "../../lib/vehicles/paperwork-input";
import { AmountWithGst } from "./amount-with-gst";
import { ChangeFormShell, useChangeForm } from "./change-form-shell";

/**
 * Records one rego renewal for a car. Choosing a term fills in Expires as the
 * current expiry plus that term, until a date is typed by hand (a lapsed rego,
 * a car bought unregistered). A monthly direct debit has no expiry.
 */
export function RegoForm(props: {
  initialValues: RegoFormValues;
  /** Where a new term runs on from: the current expiry, or today if there is none. */
  runsOnFrom: string;
  action: (state: ChangeFormState, formData: FormData) => Promise<ChangeFormState>;
  isGstRegistered: boolean;
}) {
  const [isExpiryTyped, setIsExpiryTyped] = useState(false);
  const changeForm = useChangeForm({
    action: props.action,
    fields: REGO_FORM_FIELDS,
    initialValues: props.initialValues,
    validate: (values) => fieldErrorsOf(parseRegoForm(values)),
    isRequired: isRequiredPaperworkField,
    shouldClearOnSave: true,
  });
  const form = changeForm.fields;
  const isDirectDebit = isDirectDebitTerm(form.values.termMonths);

  function handleTermChange(term: string): void {
    form.setValue("termMonths", term);
    if (isDirectDebitTerm(term)) {
      form.setValue("expiresOn", "");
    } else if (term !== "" && !isExpiryTyped) {
      form.setValue("expiresOn", addMonths(props.runsOnFrom, Number(term)));
    }
  }

  return (
    <ChangeFormShell form={changeForm} submitLabel="Add rego renewal">
      <div className="grid grid-cols-2 gap-4">
        <FormField htmlFor="state" label="State" isRequired error={form.errorFor("state")}>
          <Select
            {...form.boxProps("state")}
            onChange={(event) => form.setValue("state", event.target.value)}
          >
            <AustralianStateOptions />
          </Select>
        </FormField>
        <FormField htmlFor="termMonths" label="Term" isRequired error={form.errorFor("termMonths")}>
          <Select
            {...form.boxProps("termMonths")}
            onChange={(event) => handleTermChange(event.target.value)}
          >
            <option value="">Choose…</option>
            {REGO_TERMS_MONTHS.map((months) => (
              <option key={months} value={String(months)}>
                {regoTermLabel(months)}
              </option>
            ))}
          </Select>
        </FormField>
        {isDirectDebit ? (
          <input type="hidden" name="expiresOn" value="" />
        ) : (
          <FormField
            htmlFor="expiresOn"
            label="Expires"
            isRequired
            hint="Filled in from the term. Change it for a lapsed or new rego."
            error={form.errorFor("expiresOn")}
          >
            <Input
              {...form.textBoxProps("expiresOn")}
              onChange={(event) => {
                setIsExpiryTyped(true);
                form.setValue("expiresOn", event.target.value);
              }}
              type="date"
            />
          </FormField>
        )}
        <FormField
          htmlFor="paidOn"
          label={isDirectDebit ? "Started on" : "Paid on"}
          error={form.errorFor("paidOn")}
        >
          <Input {...form.textBoxProps("paidOn")} type="date" />
        </FormField>
      </div>
      <AmountWithGst
        form={form}
        amountField="costCents"
        gstField="gstCents"
        amountLabel={isDirectDebit ? "Cost each month" : "Cost"}
        gstSource="from_bill"
        isGstRegistered={props.isGstRegistered}
      />
    </ChangeFormShell>
  );
}
