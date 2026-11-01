"use client";

import { MAXIMUM_LINE_LENGTH } from "@fleetapp/core";
import {
  startTransition,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type FormEvent,
} from "react";
import {
  useForm,
  type DefaultValues,
  type FieldErrors as HookFormErrors,
  type Path,
  type PathValue,
  type RefCallBack,
  type Resolver,
} from "react-hook-form";

import { fieldDescriptionIds } from "../components/form-field";

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
  /**
   * Put before each box's id, for a page with several forms sharing field
   * names (e.g. Settings), so each box's id is unique and a failed save moves
   * to the right one.
   */
  idPrefix?: string;
}

/** What every box shares: its name, its value, and its error wired up for screen readers. */
export interface BoxProps {
  id: string;
  name: string;
  value: string;
  /** Lets the form move to this box when it has a problem. */
  ref: RefCallBack;
  onBlur: (event: FocusEvent<HTMLElement>) => void;
  "aria-required": true | undefined;
  "aria-invalid": true | undefined;
  "aria-describedby": string;
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
  /** The box's id, for its FormField's htmlFor. */
  idFor: (field: Field) => string;
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
  /**
   * Empties the form back to how it opened, e.g. after adding a record, so
   * pressing save again cannot add the same one twice. The answer stays shown.
   */
  clear: () => void;
}

/** React Hook Form's error shape, from our own checks' messages. */
function toFormErrors<Field extends string>(
  fieldErrors: FieldErrors<Field>,
): HookFormErrors<Record<Field, string>> {
  const formErrors: Record<string, { type: string; message: string }> = {};
  for (const [field, messages] of Object.entries(fieldErrors) as [Field, readonly string[]][]) {
    const message = messages?.[0];
    if (message) {
      formErrors[field] = { type: VALIDATION_ERROR_TYPE, message };
    }
  }
  return formErrors as HookFormErrors<Record<Field, string>>;
}

const VALIDATION_ERROR_TYPE = "validation";

/**
 * The live checking every form shares (rule 28), on React Hook Form. Each box
 * is checked once you leave it, then again with every key (its "onTouched"
 * mode). Nothing is shown for a box you have not reached yet, so an empty form
 * does not open covered in red. The checks are the server's own (`validate`).
 */
export function useFormFields<Field extends string>(
  options: FormFieldsOptions<Field>,
): FormFields<Field> {
  type Values = Record<Field, string>;
  const resolver: Resolver<Values> = (submitted) => {
    const fieldErrors = options.validate(submitted);
    const hasProblems = Object.values(fieldErrors).some(
      (messages) => (messages as readonly string[] | undefined)?.length,
    );
    return hasProblems
      ? { values: {}, errors: toFormErrors(fieldErrors) }
      : { values: submitted, errors: {} };
  };
  const form = useForm<Values>({
    defaultValues: options.initialValues as DefaultValues<Values>,
    mode: "onTouched",
    resolver,
    // We move to the first problem in the form's own order, below.
    shouldFocusError: false,
  });
  const [isResultShown, setIsResultShown] = useState(false);
  const values = form.watch() as Readonly<Values>;

  const idFor = (field: Field): string => `${options.idPrefix ?? ""}${field}`;
  const fieldPath = (field: Field): Path<Values> => field as unknown as Path<Values>;

  function errorFor(field: Field): string | undefined {
    const error = form.formState.errors[field as keyof typeof form.formState.errors] as
      { message?: string } | undefined;
    return error?.message;
  }

  function hasBeenChecked(field: Field): boolean {
    return form.getFieldState(fieldPath(field)).isTouched || form.formState.isSubmitted;
  }

  function setValue(field: Field, value: string): void {
    form.setValue(fieldPath(field), value as PathValue<Values, Path<Values>>, {
      shouldDirty: true,
      shouldValidate: hasBeenChecked(field),
    });
    setIsResultShown(false);
  }

  function fillIn(filled: Partial<Record<Field, string>>): void {
    for (const [field, value] of Object.entries(filled) as [Field, string][]) {
      form.setValue(fieldPath(field), value as PathValue<Values, Path<Values>>, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
    }
    setIsResultShown(false);
  }

  function boxProps(field: Field): BoxProps {
    const error = errorFor(field);
    const registered = form.register(fieldPath(field));
    return {
      id: idFor(field),
      name: field,
      value: values[field] ?? "",
      ref: registered.ref,
      onBlur: (event) => void registered.onBlur(event),
      "aria-required": options.isRequired(field, values) ? true : undefined,
      "aria-invalid": error ? true : undefined,
      "aria-describedby": fieldDescriptionIds(idFor(field)),
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
      const formElement = event.currentTarget;
      void form.handleSubmit(
        () => {
          const formData = new FormData(formElement);
          setIsResultShown(true);
          startTransition(() => send(formData));
        },
        (problems) => {
          const firstProblem = options.fields.find((field) => field in problems);
          if (firstProblem) {
            document.getElementById(idFor(firstProblem))?.focus();
          }
        },
      )(event);
    };
  }

  return {
    values,
    idFor,
    errorFor,
    boxProps,
    textBoxProps,
    formattedBoxProps,
    setValue,
    fillIn,
    submitHandler,
    isResultShown,
    markChanged: () => setIsResultShown(false),
    clear: () => form.reset(options.initialValues as DefaultValues<Values>),
  };
}
