"use client";

import { authClient } from "@fleetapp/auth/client";
import { Button } from "@fleetapp/ui/button";
import { ClientForm, SubmitButton } from "@fleetapp/ui/client-form";
import { FormError } from "@fleetapp/ui/form-message";
import { RequiredFieldsNote } from "@fleetapp/ui/input";
import Link from "next/link";
import { useState } from "react";

import { FORGOT_PASSWORD_PATH, SIGN_IN_PATH } from "../../lib/paths";
import {
  NEW_PASSWORD_HINT,
  NewPasswordField,
  submitLabel,
  useNewPasswordForm,
} from "../new-password-field";

const LINK_FAILED_MESSAGE = "This link no longer works. It may have expired or been used.";

export function ResetPasswordForm(props: { token: string }) {
  const { form, isLeakWarningShown, afterLeakCheck } = useNewPasswordForm();
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);

  const changePassword = afterLeakCheck(async (formData) => {
    setFormError(null);
    const { error } = await authClient.resetPassword({
      newPassword: String(formData.get("password") ?? ""),
      token: props.token,
    });
    if (error) {
      setFormError(LINK_FAILED_MESSAGE);
      return;
    }
    setIsDone(true);
  });

  if (isDone) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm">
          Your password has been changed, and you have been signed out everywhere else.
        </p>
        <Button asChild>
          <Link href={SIGN_IN_PATH}>Sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <ClientForm
      className="flex flex-col gap-4"
      noValidate
      onSubmit={form.submitHandler(async (formData) => {
        setIsSubmitting(true);
        await changePassword(formData).finally(() => setIsSubmitting(false));
      })}
    >
      <RequiredFieldsNote />
      <NewPasswordField
        form={form}
        name="password"
        label={`New password (${NEW_PASSWORD_HINT})`}
        isLeakWarningShown={isLeakWarningShown}
      />
      <NewPasswordField form={form} name="confirmation" label="Type it again" />
      <FormError message={formError} />
      <SubmitButton disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : submitLabel(isLeakWarningShown, "Change password")}
      </SubmitButton>
      {formError ? (
        <Link
          href={FORGOT_PASSWORD_PATH}
          className="text-teal hover:text-primary inline-flex min-h-11 items-center justify-center text-center text-sm font-semibold"
        >
          Send me a new link
        </Link>
      ) : null}
    </ClientForm>
  );
}
