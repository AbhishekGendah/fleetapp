"use client";

import {
  BREACHED_PASSWORD_WARNING,
  MINIMUM_PASSWORD_LENGTH,
  newPasswordSchema,
  type NewPasswordInput,
} from "@fleetapp/auth/login-policy";
import { fieldErrorsOf } from "@fleetapp/core";
import { FormField } from "@fleetapp/ui/form-field";
import { Input } from "@fleetapp/ui/input";
import { useFormFields, type FormFields, type TextBoxProps } from "@fleetapp/ui/use-form-fields";
import { useState } from "react";

import { isPasswordKnownToHaveLeakedAction } from "./new-password-actions";

type NewPasswordFieldName = keyof NewPasswordInput;

const NEW_PASSWORD_FIELDS: readonly NewPasswordFieldName[] = ["password", "confirmation"];
const EMPTY_PASSWORDS: NewPasswordInput = { password: "", confirmation: "" };
const PASSWORD_FIELD: NewPasswordFieldName = "password";

/**
 * The two "choose a password" boxes on the shared form helper, checked as they
 * are typed with the same rule the server uses (rule 28). Sending first asks
 * whether the password is known to have leaked: if so the person is warned
 * once, and pressing the button again keeps it (a warning, never a refusal).
 */
export function useNewPasswordForm(): {
  form: FormFields<NewPasswordFieldName>;
  isLeakWarningShown: boolean;
  afterLeakCheck: (
    send: (formData: FormData) => Promise<void>,
  ) => (formData: FormData) => Promise<void>;
} {
  const form = useFormFields({
    fields: NEW_PASSWORD_FIELDS,
    initialValues: EMPTY_PASSWORDS,
    validate: (values) => fieldErrorsOf(newPasswordSchema.safeParse(values)),
    isRequired: () => true,
  });
  // The password the person was warned about. Sending it again means "use it anyway".
  const [warnedPassword, setWarnedPassword] = useState<string | null>(null);
  const isLeakWarningShown = warnedPassword !== null && warnedPassword === form.values.password;

  function afterLeakCheck(
    send: (formData: FormData) => Promise<void>,
  ): (formData: FormData) => Promise<void> {
    return async (formData) => {
      const password = String(formData.get(PASSWORD_FIELD) ?? "");
      if (password !== warnedPassword) {
        const hasLeaked = await isPasswordKnownToHaveLeakedAction(password).catch(() => false);
        if (hasLeaked) {
          setWarnedPassword(password);
          return;
        }
      }
      await send(formData);
    };
  }

  return { form, isLeakWarningShown, afterLeakCheck };
}

/** The first box's label, with the length the rule asks for. */
export const NEW_PASSWORD_HINT = `at least ${MINIMUM_PASSWORD_LENGTH} characters`;

/** One of the two "choose a password" boxes, on the invite and reset pages. */
export function NewPasswordField(props: {
  form: FormFields<NewPasswordFieldName>;
  name: NewPasswordFieldName;
  label: string;
  isLeakWarningShown?: boolean;
  /** The server's answer, shown when the live check has nothing to say. */
  serverError?: string;
}) {
  const boxProps: TextBoxProps = props.form.textBoxProps(props.name);
  return (
    <FormField
      htmlFor={boxProps.id}
      label={props.label}
      isRequired
      warning={
        props.name === PASSWORD_FIELD && props.isLeakWarningShown
          ? BREACHED_PASSWORD_WARNING
          : undefined
      }
      error={props.form.errorFor(props.name) ?? props.serverError}
    >
      <Input {...boxProps} type="password" autoComplete="new-password" />
    </FormField>
  );
}

/** The submit button's words: after a leak warning, pressing it again keeps the password. */
export function submitLabel(isLeakWarningShown: boolean, label: string): string {
  return isLeakWarningShown ? "Use this password anyway" : label;
}
