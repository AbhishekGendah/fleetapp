import * as React from "react";

import { Label } from "./input";

/** The id of a field's error (or warning) message, for the box's `aria-describedby`. */
export function fieldErrorId(fieldId: string): string {
  return `${fieldId}-error`;
}

/** The id of a field's label, for a box made of parts that names itself by it (`aria-labelledby`). */
export function fieldLabelId(fieldId: string): string {
  return `${fieldId}-label`;
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

interface DescribableProps {
  "aria-describedby"?: string;
  "aria-required"?: boolean | "true" | "false";
  required?: boolean;
}

/**
 * Links the box to its hint and message for screen readers, and marks it
 * required, whatever box it is: one wiring for every form (rule 28). A box
 * that already says these things keeps what it says.
 */
function withDescriptions(
  children: React.ReactNode,
  fieldId: string,
  isRequired: boolean | undefined,
): React.ReactNode {
  if (!React.isValidElement<DescribableProps>(children)) {
    return children;
  }
  const own = children.props;
  return React.cloneElement(children, {
    "aria-describedby": own["aria-describedby"] ?? fieldDescriptionIds(fieldId),
    ...(isRequired && own.required === undefined && own["aria-required"] === undefined
      ? { "aria-required": true }
      : {}),
  });
}

/**
 * One box on a form, laid out the same everywhere: label (with an asterisk
 * if required), the box, a hint, then the error.
 */
export function FormField(props: FormFieldProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <Label id={fieldLabelId(props.htmlFor)} htmlFor={props.htmlFor} isRequired={props.isRequired}>
        {props.label}
      </Label>
      {withDescriptions(props.children, props.htmlFor, props.isRequired)}
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
