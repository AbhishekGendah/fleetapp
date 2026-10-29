"use client";

import { MAXIMUM_LINE_LENGTH } from "@fleetapp/core";
import { startTransition, useState, type ChangeEvent, type FormEvent } from "react";

import { fieldErrorId } from "../components/form-field";

/** Each field's messages, as Zod's `flattenError(...).fieldErrors` gives them. */
export type FieldErrors<Field extends string> = Partial<
  Record<Field, readonly string[] | undefined>
>;

export interface FormFieldsOptions<Field extends string> {
  fields: readonly Field[];
  initialValues: Readonly<Record<Field, string>>;
  /** The same checks the server makes on save, run on what is typed now. */
  validate: (values: Readonly<Record<Field, string>>) => FieldErrors<Field>;
  /** Given the values, since a box can become required, e.g. a date once GST is ticked. */
  isRequired: (field: Field, values: Readonly<Record<Field, string>>) => boolean;
  /** The longest text any box takes: one line of text unless said otherwise. */
  maxLength?: number;
}

/** What every box shares: its name, its value, and its error wired up for screen readers. */
export interface BoxProps {
  id: string;
  name: string;
  value: string;
  onBlur: () => void;
  "aria-required": true | undefined;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
}

export interface TextBoxProps extends BoxProps {
  maxLength: number;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

export interface FormattedBoxProps extends BoxProps {
  format: (raw: string) => string;
  onValueChange: (value: string) => void;
}

export interface FormFields<Field extends string> {
  values: Readonly<Record<Field, string>>;
  errorFor: (field: Field) => string | undefined;
  boxProps: (field: Field) => BoxProps;
  /** For an ordinary text box. */
  textBoxProps: (field: Field) => TextBoxProps;
  /** For a box that tidies what is typed, such as a phone number. */
  formattedBoxProps: (field: Field, format: (raw: string) => string) => FormattedBoxProps;
  setValue: (field: Field, value: string) => void;
  /** Fills in several boxes at once (e.g. from an address lookup) and checks them. */
  fillIn: (values: Partial<Record<Field, string>>) => void;
  /**
   * The form's onSubmit: shows every problem and moves to the first, or, if
   * there are none, sends the form to `send` (the form's server action).
   */
  submitHandler: (
    send: (formData: FormData) => void,
  ) => (event: FormEvent<HTMLFormElement>) => void;
  /**
   * True once the form is sent, until anything changes: whether the answer
   * from the server still applies and should be shown.
   */
  isResultShown: boolean;
  /** For a change outside the boxes, such as a tick box, that makes the last answer stale. */
  markChanged: () => void;
}

/**
 * The live checking every form shares (rule 28). Each box is checked once you
 * leave it, then again with every key. Nothing is shown for a box you have
 * not reached yet, so an empty form does not open covered in red.
 */
export function useFormFields<Field extends string>(
  options: FormFieldsOptions<Field>,
): FormFields<Field> {
  const [values, setValues] = useState(options.initialValues);
  const [checkedFields, setCheckedFields] = useState<ReadonlySet<Field>>(() => new Set());
  const [isResultShown, setIsResultShown] = useState(false);
  const errors = options.validate(values);

  function errorFor(field: Field): string | undefined {
    return checkedFields.has(field) ? errors[field]?.[0] : undefined;
  }

  function setValue(field: Field, value: string): void {
    setValues((previous) => ({ ...previous, [field]: value }));
    setIsResultShown(false);
  }

  function fillIn(filled: Partial<Record<Field, string>>): void {
    setValues((previous) => ({ ...previous, ...filled }));
    setCheckedFields((previous) => new Set([...previous, ...(Object.keys(filled) as Field[])]));
    setIsResultShown(false);
  }

  function boxProps(field: Field): BoxProps {
    const error = errorFor(field);
    return {
      id: field,
      name: field,
      value: values[field],
      onBlur: () => setCheckedFields((previous) => new Set(previous).add(field)),
      "aria-required": options.isRequired(field, values) ? true : undefined,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": error ? fieldErrorId(field) : undefined,
    };
  }

  function textBoxProps(field: Field): TextBoxProps {
    return {
      ...boxProps(field),
      maxLength: options.maxLength ?? MAXIMUM_LINE_LENGTH,
      onChange: (event) => setValue(field, event.target.value),
    };
  }

  function formattedBoxProps(field: Field, format: (raw: string) => string): FormattedBoxProps {
    return { ...boxProps(field), format, onValueChange: (value) => setValue(field, value) };
  }

  function submitHandler(
    send: (formData: FormData) => void,
  ): (event: FormEvent<HTMLFormElement>) => void {
    return (event) => {
      event.preventDefault();
      setCheckedFields(new Set(options.fields));
      const firstProblem = options.fields.find((field) => errors[field]?.length);
      if (firstProblem) {
        document.getElementById(firstProblem)?.focus();
        return;
      }
      const formData = new FormData(event.currentTarget);
      setIsResultShown(true);
      startTransition(() => send(formData));
    };
  }

  return {
    values,
    errorFor,
    boxProps,
    textBoxProps,
    formattedBoxProps,
    setValue,
    fillIn,
    submitHandler,
    isResultShown,
    markChanged: () => setIsResultShown(false),
  };
}
