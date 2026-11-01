import type * as React from "react";

import { Label } from "./input";

/** The id of a field's error (or warning) message, for the box's `aria-describedby`. */
export function fieldErrorId(fieldId: string): string {
  return `${fieldId}-error`;
}

/** The id of a field's hint, for the box's `aria-describedby`. */
export function fieldHintId(fieldId: string): string {
  return `${fieldId}-hint`;
}

/**
 * What a box is described by: its message and its hint, each read out when
 * it is there (a missing id is skipped), so hints, warnings and refusals
 * from the server all reach a screen reader.
 */
export function fieldDescriptionIds(fieldId: string): string {
  return `${fieldErrorId(fieldId)} ${fieldHintId(fieldId)}`;
}

interface FormFieldProps {
  /** The id of the box inside, which the label points at. */
  htmlFor: string;
  label: string;
  /** Shows the asterisk. The box must also carry `required` or `aria-required`. */
  isRequired?: boolean;
  hint?: string;
  /** Worth knowing, but not wrong: shown in amber, and does not block saving. */
  warning?: string;
  error?: string;
  children: React.ReactNode;
}

/**
 * One box on a form, laid out the same everywhere: label (with an asterisk
 * if required), the box, a hint, then the error.
 */
export function FormField(props: FormFieldProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={props.htmlFor} isRequired={props.isRequired}>
        {props.label}
      </Label>
      {props.children}
      {props.hint ? (
        <p id={fieldHintId(props.htmlFor)} className="text-muted-foreground text-xs">
          {props.hint}
        </p>
      ) : null}
      {props.warning && !props.error ? (
        <p id={fieldErrorId(props.htmlFor)} className="text-attention text-sm" role="status">
          {props.warning}
        </p>
      ) : null}
      {props.error ? (
        <p id={fieldErrorId(props.htmlFor)} className="text-destructive text-sm">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}
