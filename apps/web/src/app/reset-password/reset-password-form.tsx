"use client";

import { authClient } from "@fleetapp/auth/client";
import { BREACHED_PASSWORD_CODE, BREACHED_PASSWORD_MESSAGE } from "@fleetapp/auth/login-policy";
import { Button } from "@fleetapp/ui/button";
import { ClientForm, SubmitButton } from "@fleetapp/ui/client-form";
import { FormError } from "@fleetapp/ui/form-message";
import { RequiredFieldsNote } from "@fleetapp/ui/input";
import Link from "next/link";
import { useState } from "react";

import { FORGOT_PASSWORD_PATH, SIGN_IN_PATH } from "../../lib/paths";
import { NEW_PASSWORD_HINT, NewPasswordField, useNewPasswordChecks } from "../new-password-field";

const LINK_FAILED_MESSAGE = "This link no longer works. It may have expired or been used.";

export function ResetPasswordForm(props: { token: string }) {
  const { values, fieldProps, checkAll, setServerPasswordProblem } = useNewPasswordChecks();
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    if (!checkAll()) {
      return;
    }

    setIsSubmitting(true);
    const { error } = await authClient.resetPassword({
      newPassword: values.password,
      token: props.token,
    });
    setIsSubmitting(false);
    if (error?.code === BREACHED_PASSWORD_CODE) {
      setServerPasswordProblem(BREACHED_PASSWORD_MESSAGE);
      return;
    }
    if (error) {
      setFormError(LINK_FAILED_MESSAGE);
      return;
    }
    setIsDone(true);
  }

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
    <ClientForm className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
      <RequiredFieldsNote />
      <NewPasswordField {...fieldProps("password")} label={`New password (${NEW_PASSWORD_HINT})`} />
      <NewPasswordField {...fieldProps("confirmation")} label="Type it again" />
      <FormError message={formError} />
      <SubmitButton disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : "Change password"}
      </SubmitButton>
      {formError ? (
        <Link href={FORGOT_PASSWORD_PATH} className="text-center text-sm hover:underline">
          Send me a new link
        </Link>
      ) : null}
    </ClientForm>
  );
}
