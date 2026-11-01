"use client";

import * as React from "react";
import { NumberFormatBase } from "react-number-format";

import { Input } from "./input";

type FormattedInputProps = Omit<
  React.ComponentPropsWithoutRef<"input">,
  "value" | "onChange" | "defaultValue" | "type"
> & {
  value: string;
  /** The real box inside, e.g. for moving to it when it has a problem. */
  ref?: React.Ref<HTMLInputElement>;
  /** "tel" opens the phone keypad. */
  type?: "text" | "tel";
  /** Turns whatever is in the box into how it should look. */
  format: (raw: string) => string;
  onValueChange: (formatted: string) => void;
};

const DIGIT = /\d/;
/** What the format rules read: the digits, and a leading "+" (for "+61" phone numbers). */
const NOT_DIGIT_OR_LEADING_PLUS = /(?!^\+)[^\d]/g;

/** The cursor may sit next to a digit, never inside a run of spaces or brackets. */
function caretBoundary(formatted: string): boolean[] {
  return Array.from({ length: formatted.length + 1 }, (_, position) => {
    const before = formatted.charAt(position - 1);
    const after = formatted.charAt(position);
    return position === formatted.length || DIGIT.test(before) || DIGIT.test(after);
  });
}

/**
 * A box that reformats as you type (spaces in an ABN, brackets round an area
 * code) without the cursor jumping, on react-number-format's formatting
 * engine: it keeps the cursor in place and handles Backspace over a space.
 * Made for numbers: `format` (ours, e.g. Google's phone rules) decides the look.
 */
export function FormattedInput({
  value,
  format,
  onValueChange,
  ref,
  ...props
}: FormattedInputProps) {
  return (
    <NumberFormatBase
      {...props}
      customInput={Input}
      getInputRef={ref}
      value={value}
      format={format}
      removeFormatting={(typed) => typed.trim().replace(NOT_DIGIT_OR_LEADING_PLUS, "")}
      getCaretBoundary={caretBoundary}
      onValueChange={(values) => onValueChange(values.formattedValue)}
    />
  );
}
