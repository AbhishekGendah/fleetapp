"use client";

import { formatDollarsAsTyped } from "@fleetapp/core";
import type * as React from "react";

import { FormattedInput } from "./formatted-input";

type MoneyInputProps = Omit<
  React.ComponentPropsWithoutRef<typeof FormattedInput>,
  "format" | "inputMode"
>;

/** A dollar box: shows "$1,234.56" as you type, and opens the number pad on a phone. */
export function MoneyInput({ placeholder = "$0.00", ...props }: MoneyInputProps) {
  return (
    <FormattedInput
      {...props}
      format={formatDollarsAsTyped}
      inputMode="decimal"
      placeholder={placeholder}
    />
  );
}
