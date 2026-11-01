"use client";

import { MAXIMUM_WHOLE_DOLLAR_DIGITS } from "@fleetapp/core";
import type * as React from "react";
import { NumericFormat } from "react-number-format";

import { Input } from "./input";

type MoneyInputProps = Omit<
  React.ComponentPropsWithoutRef<"input">,
  "value" | "onChange" | "defaultValue" | "type" | "inputMode"
> & {
  value: string;
  /** The real box inside, e.g. for moving to it when it has a problem. */
  ref?: React.Ref<HTMLInputElement>;
  onValueChange: (formatted: string) => void;
};

const CENTS_DIGITS = 2;

/**
 * A dollar box on react-number-format: shows "$1,234.56" as you type (rule
 * 31), never more than two decimal places or a negative, and opens the number
 * pad on a phone. The server reads the same text with the same rules.
 */
export function MoneyInput({
  placeholder = "$0.00",
  value,
  onValueChange,
  ref,
  ...props
}: MoneyInputProps) {
  return (
    <NumericFormat
      {...props}
      customInput={Input}
      getInputRef={ref}
      value={value}
      prefix="$"
      thousandSeparator=","
      decimalScale={CENTS_DIGITS}
      allowNegative={false}
      allowLeadingZeros={false}
      inputMode="decimal"
      placeholder={placeholder}
      // Stops at the largest amount the app takes, so the box cannot fill with digits.
      isAllowed={({ value: digits }) =>
        (digits.split(".")[0] ?? "").length <= MAXIMUM_WHOLE_DOLLAR_DIGITS
      }
      onValueChange={(values) => onValueChange(values.formattedValue)}
    />
  );
}
