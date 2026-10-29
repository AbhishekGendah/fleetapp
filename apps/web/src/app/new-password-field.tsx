"use client";

import {
  MINIMUM_PASSWORD_LENGTH,
  newPasswordSchema,
  type NewPasswordInput,
} from "@fleetapp/auth/login-policy";
import { fieldErrorId, FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import { useMemo, useState } from "react";
import { z } from "zod";

type NewPasswordFieldName = keyof NewPasswordInput;

const NEW_PASSWORD_FIELDS: readonly NewPasswordFieldName[] = ["password", "confirmation"];

/**
 * The two "choose a password" boxes, checked as they are typed with the same
 * rule the server uses (rule 28). A box shows its problem once it has been
 * left, or once the form is submitted.
 */
export function useNewPasswordChecks() {
  const [values, setValues] = useState<NewPasswordInput>({ password: "", confirmation: "" });
  // A problem only the server can find (a leaked password), cleared on the next key.
  const [serverPasswordProblem, setServerPasswordProblem] = useState<string | null>(null);
  const [checkedFields, setCheckedFields] = useState<ReadonlySet<NewPasswordFieldName>>(
    () => new Set(),
  );

  const errors = useMemo(() => {
    const parsed = newPasswordSchema.safeParse(values);
    return parsed.success ? {} : z.flattenError(parsed.error).fieldErrors;
  }, [values]);

  function fieldProps(name: NewPasswordFieldName): NewPasswordFieldProps {
    return {
      name,
      value: values[name],
      error:
        (checkedFields.has(name) ? errors[name]?.[0] : undefined) ??
        (name === "password" ? (serverPasswordProblem ?? undefined) : undefined),
      onValueChange: (value) => {
        setValues((previous) => ({ ...previous, [name]: value }));
        if (name === "password") {
          setServerPasswordProblem(null);
        }
      },
      onBlur: () => setCheckedFields((previous) => new Set(previous).add(name)),
    };
  }

  /** Shows every problem; true if there are none and the form may be sent. */
  function checkAll(): boolean {
    setCheckedFields(new Set(NEW_PASSWORD_FIELDS));
    return Object.keys(errors).length === 0;
  }

  return { values, fieldProps, checkAll, setServerPasswordProblem };
}

/** The first box's label, with the length the rule asks for. */
export const NEW_PASSWORD_HINT = `at least ${MINIMUM_PASSWORD_LENGTH} characters`;

interface NewPasswordFieldProps {
  name: NewPasswordFieldName;
  value: string;
  error: string | undefined;
  onValueChange: (value: string) => void;
  onBlur: () => void;
}

/** One of the two "choose a password" boxes, on the invite and reset pages. */
export function NewPasswordField(props: NewPasswordFieldProps & { label: string }) {
  return (
    <FormField htmlFor={props.name} label={props.label} isRequired error={props.error}>
      <Input
        id={props.name}
        name={props.name}
        type="password"
        autoComplete="new-password"
        required
        value={props.value}
        onChange={(event) => props.onValueChange(event.target.value)}
        onBlur={props.onBlur}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={props.error ? fieldErrorId(props.name) : undefined}
      />
    </FormField>
  );
}
