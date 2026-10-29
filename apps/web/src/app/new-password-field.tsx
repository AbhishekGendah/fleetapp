"use client";

import {
  BREACHED_PASSWORD_WARNING,
  MINIMUM_PASSWORD_LENGTH,
  newPasswordSchema,
  type NewPasswordInput,
} from "@fleetapp/auth/login-policy";
import { fieldErrorId, FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import { useMemo, useState } from "react";
import { z } from "zod";

import { isPasswordKnownToHaveLeakedAction } from "./new-password-actions";

type NewPasswordFieldName = keyof NewPasswordInput;

const NEW_PASSWORD_FIELDS: readonly NewPasswordFieldName[] = ["password", "confirmation"];

/**
 * The two "choose a password" boxes, checked as they are typed with the same
 * rule the server uses (rule 28). A box shows its problem once it has been
 * left, or once the form is submitted.
 */
export function useNewPasswordChecks() {
  const [values, setValues] = useState<NewPasswordInput>({ password: "", confirmation: "" });
  const [checkedFields, setCheckedFields] = useState<ReadonlySet<NewPasswordFieldName>>(
    () => new Set(),
  );
  // The password the person was warned about. Sending it again means "use it anyway".
  const [warnedPassword, setWarnedPassword] = useState<string | null>(null);

  const errors = useMemo(() => {
    const parsed = newPasswordSchema.safeParse(values);
    return parsed.success ? {} : z.flattenError(parsed.error).fieldErrors;
  }, [values]);

  const isLeakWarningShown = warnedPassword !== null && warnedPassword === values.password;

  function fieldProps(name: NewPasswordFieldName): NewPasswordFieldProps {
    return {
      name,
      value: values[name],
      error: checkedFields.has(name) ? errors[name]?.[0] : undefined,
      warning: name === "password" && isLeakWarningShown ? BREACHED_PASSWORD_WARNING : undefined,
      onValueChange: (value) => setValues((previous) => ({ ...previous, [name]: value })),
      onBlur: () => setCheckedFields((previous) => new Set(previous).add(name)),
    };
  }

  /**
   * True when the form may be sent: both boxes pass, and either the password
   * is not known to have leaked or the person has already been warned and
   * pressed the button again. A warning, never a refusal.
   */
  async function isReadyToSend(): Promise<boolean> {
    setCheckedFields(new Set(NEW_PASSWORD_FIELDS));
    if (Object.keys(errors).length > 0) {
      return false;
    }
    if (isLeakWarningShown) {
      return true;
    }
    const hasLeaked = await isPasswordKnownToHaveLeakedAction(values.password).catch(() => false);
    if (hasLeaked) {
      setWarnedPassword(values.password);
      return false;
    }
    return true;
  }

  return { values, fieldProps, isReadyToSend, isLeakWarningShown };
}

/** The first box's label, with the length the rule asks for. */
export const NEW_PASSWORD_HINT = `at least ${MINIMUM_PASSWORD_LENGTH} characters`;

interface NewPasswordFieldProps {
  name: NewPasswordFieldName;
  value: string;
  error: string | undefined;
  warning: string | undefined;
  onValueChange: (value: string) => void;
  onBlur: () => void;
}

/** One of the two "choose a password" boxes, on the invite and reset pages. */
export function NewPasswordField(props: NewPasswordFieldProps & { label: string }) {
  return (
    <FormField
      htmlFor={props.name}
      label={props.label}
      isRequired
      warning={props.warning}
      error={props.error}
    >
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
        aria-describedby={props.error || props.warning ? fieldErrorId(props.name) : undefined}
      />
    </FormField>
  );
}

/** The submit button's words: after a leak warning, pressing it again keeps the password. */
export function submitLabel(isLeakWarningShown: boolean, label: string): string {
  return isLeakWarningShown ? "Use this password anyway" : label;
}
