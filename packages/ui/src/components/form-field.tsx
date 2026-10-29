import type * as React from "react";

import { Label } from "./input";

/** The id of a field's error message, for the box's `aria-describedby`. */
export function fieldErrorId(fieldId: string): string {
  return `${fieldId}-error`;
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
      {props.hint ? <p className="text-muted-foreground text-xs">{props.hint}</p> : null}
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
