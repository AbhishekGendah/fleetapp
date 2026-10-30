"use client";

import { centsForEditing, gstIncludedIn, parseDollars } from "@fleetapp/core";
import { Checkbox } from "@fleetapp/ui/checkbox";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import type { FormFields } from "@fleetapp/ui/use-form-fields";
import { useState } from "react";

/**
 * Where the GST figure comes from. An insurance premium includes GST on the
 * whole amount, so a tenth is right. A rego bill has GST only on its
 * injury-insurance part, so the figure is copied from the notice instead.
 */
export type GstSource = "tenth_of_amount" | "from_bill";

const GST_HINTS: Record<GstSource, string> = {
  tenth_of_amount: "A tenth of the amount is filled in. Change it if the bill shows less.",
  from_bill:
    "Copy the GST amount from the renewal notice. Only its injury-insurance part has GST, so it is much less than a tenth.",
};

interface AmountWithGstProps<Field extends string> {
  form: FormFields<Field>;
  amountField: Field;
  gstField: Field;
  amountLabel: string;
  gstSource: GstSource;
  /** From business details. A business not registered for GST has no GST to claim back. */
  isGstRegistered: boolean;
}

function tenthOf(typedAmount: string): string {
  const cents = parseDollars(typedAmount);
  return cents === null ? "" : centsForEditing(gstIncludedIn(cents));
}

function hasSavedGst(typedGst: string): boolean {
  return typedGst !== "" && parseDollars(typedGst) !== 0;
}

/**
 * An amount and the GST inside it (rule 9). Ticking "Includes GST" shows the
 * GST box, filled in with a tenth or left for the figure on the bill; unticked,
 * there is no GST. Hidden for a business not registered for GST, unless an
 * earlier save recorded some, so editing never drops it unseen.
 */
export function AmountWithGst<Field extends string>(props: AmountWithGstProps<Field>) {
  const { form, amountField, gstField, gstSource } = props;
  const isTenthFilledIn = gstSource === "tenth_of_amount";
  // Decided once, from what the form opened with, so unticking does not make the box vanish.
  const [isGstShown] = useState(
    () => props.isGstRegistered || hasSavedGst(form.values[gstField]),
  );
  const [includesGst, setIncludesGst] = useState(() =>
    form.values[gstField] ? hasSavedGst(form.values[gstField]) : isGstShown && isTenthFilledIn,
  );

  function handleAmountChange(typed: string): void {
    form.setValue(amountField, typed);
    if (includesGst && isTenthFilledIn) {
      form.setValue(gstField, tenthOf(typed));
    }
  }

  function handleIncludesGstChange(isTicked: boolean): void {
    setIncludesGst(isTicked);
    form.setValue(gstField, isTicked && isTenthFilledIn ? tenthOf(form.values[amountField]) : "");
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
      {isGstShown ? (
        <Checkbox
          label="Includes GST"
          checked={includesGst}
          onChange={(event) => handleIncludesGstChange(event.target.checked)}
        />
      ) : null}
      {isGstShown && includesGst ? (
        <FormField
          htmlFor={gstField}
          label="GST included"
          hint={GST_HINTS[gstSource]}
          error={form.errorFor(gstField)}
        >
          <Input {...form.textBoxProps(gstField)} inputMode="decimal" placeholder="$0.00" />
        </FormField>
      ) : (
        <input type="hidden" name={gstField} value="" />
      )}
    </>
  );
}
