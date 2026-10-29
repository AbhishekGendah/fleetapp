"use client";

import { centsForEditing, gstIncludedIn, parseDollars } from "@fleetapp/core";
import { Checkbox } from "@fleetapp/ui/checkbox";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import type { FormFields } from "@fleetapp/ui/use-form-fields";
import { useState } from "react";

interface AmountWithGstProps<Field extends string> {
  form: FormFields<Field>;
  amountField: Field;
  gstField: Field;
  amountLabel: string;
  /** Insurance premiums include GST; rego is mostly GST-free. */
  isGstUsuallyIncluded: boolean;
}

function gstFor(typedAmount: string): string {
  const cents = parseDollars(typedAmount);
  return cents === null ? "" : centsForEditing(gstIncludedIn(cents));
}

/**
 * An amount and the GST inside it (rule 9). Ticking "Includes GST" fills
 * in a tenth, which can then be changed for a bill that mixes GST and
 * GST-free items; unticked, there is no GST.
 */
export function AmountWithGst<Field extends string>(props: AmountWithGstProps<Field>) {
  const { form, amountField, gstField } = props;
  const [includesGst, setIncludesGst] = useState(() =>
    form.values[gstField] ? parseDollars(form.values[gstField]) !== 0 : props.isGstUsuallyIncluded,
  );

  function handleAmountChange(typed: string): void {
    form.setValue(amountField, typed);
    if (includesGst) {
      form.setValue(gstField, gstFor(typed));
    }
  }

  function handleIncludesGstChange(isTicked: boolean): void {
    setIncludesGst(isTicked);
    form.setValue(gstField, isTicked ? gstFor(form.values[amountField]) : "");
  }

  return (
    <>
      <FormField
        htmlFor={amountField}
        label={props.amountLabel}
        isRequired
        error={form.errorFor(amountField)}
      >
        <Input
          {...form.textBoxProps(amountField)}
          onChange={(event) => handleAmountChange(event.target.value)}
          inputMode="decimal"
          placeholder="$0.00"
        />
      </FormField>
      <Checkbox
        label="Includes GST"
        checked={includesGst}
        onChange={(event) => handleIncludesGstChange(event.target.checked)}
      />
      {includesGst ? (
        <FormField
          htmlFor={gstField}
          label="GST included"
          hint="A tenth of the amount is filled in. Change it if the bill shows less."
          error={form.errorFor(gstField)}
        >
          <Input {...form.textBoxProps(gstField)} inputMode="decimal" />
        </FormField>
      ) : (
        <input type="hidden" name={gstField} value="" />
      )}
    </>
  );
}
