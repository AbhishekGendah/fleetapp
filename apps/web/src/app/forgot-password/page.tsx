"use client";

import { authClient } from "@fleetapp/auth/client";
import { fieldErrorsOf, requiredEmail } from "@fleetapp/core";
import { AuthPageLayout } from "@fleetapp/ui/auth-page-layout";
import { ClientForm, SubmitButton } from "@fleetapp/ui/client-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { FormField } from "@fleetapp/ui/form-field";
import { Input, RequiredFieldsNote } from "@fleetapp/ui/input";
import { useFormFields } from "@fleetapp/ui/use-form-fields";
import Link from "next/link";
import { useState } from "react";
import { z } from "zod";

import { RESET_LINK_LIFETIME_WORDS } from "../../lib/password-reset-policy";
import { RESET_PASSWORD_PATH, SIGN_IN_PATH } from "../../lib/paths";

/**
 * Always the same answer, whatever happened: saying "no login with that
 * email" would tell anyone which addresses have one.
 */
const SENT_MESSAGE = `If that address has a login, we have emailed it a link to choose a new password. The link works for ${RESET_LINK_LIFETIME_WORDS}.`;

const EMAIL_FIELDS = ["email"] as const;
const forgotPasswordSchema = z.object({ email: requiredEmail });

export default function ForgotPasswordPage() {
  const form = useFormFields({
    fields: EMAIL_FIELDS,
    initialValues: { email: "" },
    validate: (values) => fieldErrorsOf(forgotPasswordSchema.safeParse(values)),
    isRequired: () => true,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);

  async function requestLink(formData: FormData): Promise<void> {
    setIsSubmitting(true);
    const { error } = await authClient.requestPasswordReset({
      email: String(formData.get("email") ?? "").trim(),
      redirectTo: RESET_PASSWORD_PATH,
    });
    if (error) {
      // Shown the same message regardless; logged so a real fault is noticed.
      console.error("Requesting a password reset failed", error.status);
    }
    setIsSubmitting(false);
    setIsSent(true);
  }

  return (
    <AuthPageLayout>
      <Card>
        <CardHeader>
          <CardTitle>Forgot your password?</CardTitle>
          <CardDescription>
            {isSent ? SENT_MESSAGE : "Enter your email and we will send you a link."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {isSent ? null : (
            <ClientForm
              className="flex flex-col gap-4"
              noValidate
              onSubmit={form.submitHandler((formData) => void requestLink(formData))}
            >
              <RequiredFieldsNote />
              <FormField
                htmlFor={form.idFor("email")}
                label="Email address"
                isRequired
                error={form.errorFor("email")}
              >
                <Input {...form.textBoxProps("email")} type="email" autoComplete="username" />
              </FormField>
              <SubmitButton disabled={isSubmitting}>
                {isSubmitting ? "Sending…" : "Send me a link"}
              </SubmitButton>
            </ClientForm>
          )}
          <Link
            href={SIGN_IN_PATH}
            className="inline-flex min-h-11 items-center justify-center text-center text-sm hover:underline"
          >
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    </AuthPageLayout>
  );
}
