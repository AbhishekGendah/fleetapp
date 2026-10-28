"use client";

import { AuthPageLayout } from "@fleetapp/ui/auth-page-layout";
import { Button } from "@fleetapp/ui/button";
import { ClientForm, SubmitButton } from "@fleetapp/ui/client-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { FormField } from "@fleetapp/ui/form-field";
import { Input, RequiredFieldsNote } from "@fleetapp/ui/input";
import Link from "next/link";
import { useState } from "react";

import { authClient } from "../../lib/auth-client";
import { RESET_LINK_LIFETIME_WORDS } from "../../lib/password-reset-policy";
import { RESET_PASSWORD_PATH, SIGN_IN_PATH } from "../../lib/paths";

/**
 * Always the same answer, whatever happened: saying "no login with that
 * email" would tell anyone which addresses have one.
 */
const SENT_MESSAGE = `If that address has a login, we have emailed it a link to choose a new password. The link works for ${RESET_LINK_LIFETIME_WORDS}.`;

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSent, setIsSent] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    const { error } = await authClient.requestPasswordReset({
      email,
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
            <ClientForm className="flex flex-col gap-4" onSubmit={handleSubmit}>
              <RequiredFieldsNote />
              <FormField htmlFor="email" label="Email address" isRequired>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </FormField>
              <SubmitButton disabled={isSubmitting}>
                {isSubmitting ? "Sending…" : "Send me a link"}
              </SubmitButton>
            </ClientForm>
          )}
          <Link href={SIGN_IN_PATH} className="text-center text-sm hover:underline">
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    </AuthPageLayout>
  );
}
