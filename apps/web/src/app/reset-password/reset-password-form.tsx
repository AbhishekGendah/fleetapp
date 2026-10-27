"use client";

import { Button } from "@fleetapp/ui/button";
import { ClientForm, SubmitButton } from "@fleetapp/ui/client-form";
import { FormError } from "@fleetapp/ui/form-message";
import Link from "next/link";
import { useState } from "react";

import { authClient } from "../../lib/auth-client";
import { FORGOT_PASSWORD_PATH, SIGN_IN_PATH } from "../../lib/paths";
import { NewPasswordField } from "../new-password-field";

const LINK_FAILED_MESSAGE = "This link no longer works. It may have expired or been used.";

interface ResetPasswordFormProps {
  token: string;
  minimumLength: number;
}

/** The checks the server makes anyway, made first so a typo costs no round trip. */
function checkNewPassword(
  password: string,
  confirmation: string,
  minimumLength: number,
): Partial<Record<"password" | "confirmation", string[]>> | null {
  if (password.length < minimumLength) {
    return { password: [`At least ${minimumLength} characters.`] };
  }
  if (password !== confirmation) {
    return { confirmation: ["The two passwords were not the same."] };
  }
  return null;
}

export function ResetPasswordForm(props: ResetPasswordFormProps) {
  const [fieldErrors, setFieldErrors] = useState<ReturnType<typeof checkNewPassword>>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDone, setIsDone] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const errors = checkNewPassword(
      password,
      String(form.get("confirmation") ?? ""),
      props.minimumLength,
    );
    setFieldErrors(errors);
    setFormError(null);
    if (errors) {
      return;
    }

    setIsSubmitting(true);
    const { error } = await authClient.resetPassword({ newPassword: password, token: props.token });
    setIsSubmitting(false);
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
    <ClientForm className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <NewPasswordField
        name="password"
        label={`New password (at least ${props.minimumLength} characters)`}
        errors={fieldErrors?.password}
      />
      <NewPasswordField
        name="confirmation"
        label="Type it again"
        errors={fieldErrors?.confirmation}
      />
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
