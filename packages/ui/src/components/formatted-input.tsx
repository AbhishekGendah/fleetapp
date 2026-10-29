"use client";

import { digitsOnly } from "@fleetapp/core";
import * as React from "react";

import { countDigitsBefore, positionAfterDigits, removeDigit } from "../lib/caret";
import { Input } from "./input";

type FormattedInputProps = Omit<React.ComponentPropsWithoutRef<"input">, "value" | "onChange"> & {
  value: string;
  /** Turns whatever is in the box into how it should look. */
  format: (raw: string) => string;
  onValueChange: (formatted: string) => void;
};

/**
 * A box that reformats as you type (spaces in an ABN, brackets round an area
 * code) without the cursor jumping to the end. Made for numbers: the cursor
 * is kept after the same digit it was after.
 */
export function FormattedInput({ value, format, onValueChange, ...props }: FormattedInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const pendingCaret = React.useRef<number | null>(null);

  React.useLayoutEffect(() => {
    if (pendingCaret.current === null || document.activeElement !== inputRef.current) {
      return;
    }
    inputRef.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  });

  function handleChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const input = event.target;
    const caret = input.selectionStart ?? input.value.length;
    let raw = input.value;
    let digitsBeforeCaret = countDigitsBefore(raw, caret);

    // Backspace on a space or bracket would be undone by reformatting, leaving
    // the cursor stuck: take out the digit before it instead.
    const isBackspace = (event.nativeEvent as InputEvent).inputType === "deleteContentBackward";
    if (isBackspace && digitsOnly(raw) === digitsOnly(value)) {
      raw = removeDigit(raw, digitsBeforeCaret);
      digitsBeforeCaret -= 1;
    }

    const formatted = format(raw);
    pendingCaret.current = positionAfterDigits(formatted, digitsBeforeCaret);
    onValueChange(formatted);
  }

  return <Input ref={inputRef} value={value} onChange={handleChange} {...props} />;
}
