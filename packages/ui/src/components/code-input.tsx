"use client";

import { digitsOnly } from "@fleetapp/core";
import { OTPInput, REGEXP_ONLY_DIGITS } from "input-otp";
import { useEffect, useRef } from "react";

import { cn } from "../lib/utils";

/** Authenticator apps show 6-digit codes. */
export const TOTP_CODE_LENGTH = 6;

export interface CodeInputProps {
  id: string;
  name: string;
  value: string;
  onChange(value: string): void;
  length: number;
  autoFocus?: boolean;
  /** For the field's accessible name when no <label> points at `id`. */
  ariaLabel?: string;
  /**
   * Called once the last digit goes in, so the code can be checked straight
   * away, as most sign-ins do. The form's own button still works too.
   */
  onComplete?(value: string): void;
  /** While a code is being checked: nothing more can be typed. */
  isDisabled?: boolean;
  /** Set by FormField, so a wrong-code message is read out with the box. */
  "aria-describedby"?: string;
}

/**
 * A one-time code shown as one box per digit, on input-otp (the library
 * shadcn uses). It is a single real input behind the boxes, not one input
 * per box, so pasting a whole code fills every box, an authenticator app or
 * password manager can fill it in, the phone shows its number pad, and a
 * screen reader hears one field rather than six.
 */
export function CodeInput(props: CodeInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const wasDisabled = useRef(false);

  // A field loses focus while it is disabled. When checking ends (a wrong
  // code, say), the cursor goes straight back so the next try needs no tap.
  useEffect(() => {
    if (wasDisabled.current && !props.isDisabled) {
      inputRef.current?.focus();
    }
    wasDisabled.current = Boolean(props.isDisabled);
  }, [props.isDisabled]);

  // Full is full (rule 31): once every box has a digit, another key would
  // replace the last one. Backspace, or tapping a box to change it, still works.
  function acceptTyped(next: string): void {
    const isFull = props.value.length === props.length;
    const onlyLastDigitChanged =
      next.length === props.length && next.slice(0, -1) === props.value.slice(0, -1);
    if (isFull && onlyLastDigitChanged) {
      return;
    }
    props.onChange(next);
  }

  return (
    <OTPInput
      ref={inputRef}
      id={props.id}
      name={props.name}
      maxLength={props.length}
      value={props.value}
      onChange={acceptTyped}
      onComplete={(code: string) => props.onComplete?.(code)}
      pattern={REGEXP_ONLY_DIGITS}
      // A pasted "123 456" or "Your code is 123456" still gives the digits.
      pasteTransformer={(pasted) => digitsOnly(pasted).slice(0, props.length)}
      onPaste={(event) => {
        // A whole code replaces the digits already there, rather than being added after them.
        const pasted = digitsOnly(event.clipboardData.getData("text"));
        if (pasted.length < props.length) {
          return;
        }
        event.preventDefault();
        const code = pasted.slice(0, props.length);
        props.onChange(code);
        props.onComplete?.(code);
      }}
      inputMode="numeric"
      autoComplete="one-time-code"
      required
      autoFocus={props.autoFocus}
      aria-label={props.ariaLabel}
      aria-describedby={props["aria-describedby"]}
      disabled={props.isDisabled}
      // 16px or more stops phones zooming in on focus.
      className="text-base"
      containerClassName="flex justify-between gap-1.5"
      render={({ slots }) => (
        <>
          {slots.map((slot, index) => (
            <span
              key={index}
              className={cn(
                "bg-card flex h-12 max-w-12 flex-1 items-center justify-center rounded-lg border text-xl font-semibold",
                slot.isActive && "border-teal ring-teal/30 ring-2",
              )}
            >
              {slot.char ??
                (slot.hasFakeCaret ? (
                  <span className="bg-teal animate-caret-blink h-6 w-0.5" />
                ) : null)}
            </span>
          ))}
        </>
      )}
    />
  );
}
