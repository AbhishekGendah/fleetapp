"use client";

import { digitsOnly } from "@fleetapp/core";
import { useEffect, useRef, useState } from "react";

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
}

/**
 * A one-time code shown as one box per digit.
 *
 * It is a single real input laid invisibly over the boxes, not one input per
 * box. So pasting a whole code fills every box, an authenticator app or
 * password manager can fill it in, the phone shows its number pad, and a
 * screen reader hears one field rather than six.
 */
export function CodeInput(props: CodeInputProps) {
  const [isFocused, setIsFocused] = useState(false);
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

  const activeIndex = Math.min(props.value.length, props.length - 1);

  function acceptDigits(digits: string): void {
    props.onChange(digits);
    if (digits.length === props.length && digits !== props.value) {
      props.onComplete?.(digits);
    }
  }

  // A pasted whole code replaces what is there, rather than being added after
  // the digits already typed and cut short.
  function handlePaste(event: React.ClipboardEvent<HTMLInputElement>): void {
    const pasted = digitsOnly(event.clipboardData.getData("text"));
    if (pasted.length < props.length) {
      return;
    }
    event.preventDefault();
    acceptDigits(pasted.slice(0, props.length));
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={props.id}
        name={props.name}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={props.length}
        required
        autoFocus={props.autoFocus}
        aria-label={props.ariaLabel}
        value={props.value}
        disabled={props.isDisabled}
        onChange={(event) => acceptDigits(digitsOnly(event.target.value).slice(0, props.length))}
        onPaste={handlePaste}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        // 16px or more stops phones zooming in on focus; the text itself is
        // invisible because the boxes underneath show it.
        className="absolute inset-0 h-full w-full cursor-text text-base opacity-0"
      />
      <div aria-hidden className="flex justify-between gap-1.5">
        {Array.from({ length: props.length }, (_, index) => {
          const isActive = isFocused && index === activeIndex;
          return (
            <span
              key={index}
              className={cn(
                "bg-card flex h-12 max-w-12 flex-1 items-center justify-center rounded-lg border text-xl font-semibold",
                isActive && "border-teal ring-teal/30 ring-2",
              )}
            >
              {props.value[index] ??
                (isActive ? <span className="bg-teal animate-caret-blink h-6 w-0.5" /> : null)}
            </span>
          );
        })}
      </div>
    </div>
  );
}
