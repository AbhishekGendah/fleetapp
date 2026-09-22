"use client";

import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { Input, Label } from "@fleetapp/ui/input";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "../../lib/auth-client";

const TOTP_CODE_LENGTH = 6;

/**
 * Deliberately vague, and the same whatever went wrong. Telling someone which
 * half they got right tells an attacker which emails exist.
 */
const SIGN_IN_FAILED_MESSAGE = "That email address and password did not match.";
const CODE_FAILED_MESSAGE = "That code was not right. Check your authenticator app and try again.";

type Step = "password" | "code";

export default function SignInPage() {
  const router = useRouter();

  const [step, setStep] = useState<Step>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handlePasswordSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    const { data, error } = await authClient.signIn.email({ email, password });

    setIsSubmitting(false);

    if (error) {
      setErrorMessage(SIGN_IN_FAILED_MESSAGE);
      setPassword("");
      return;
    }

    // Every Admin has an authenticator app, so a successful password always
    // leads to the code step rather than straight in.
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      setStep("code");
      return;
    }

    router.push("/");
  }

  async function handleCodeSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    const { error } = await authClient.twoFactor.verifyTotp({ code });

    setIsSubmitting(false);

    if (error) {
      setErrorMessage(CODE_FAILED_MESSAGE);
      setCode("");
      return;
    }

    router.push("/");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            {step === "password"
              ? "Altus Global Solutions platform admin."
              : "Enter the 6-digit code from your authenticator app."}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {step === "password" ? (
            <form className="flex flex-col gap-4" onSubmit={handlePasswordSubmit}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>

              {errorMessage ? (
                <p className="text-destructive text-sm" role="alert">
                  {errorMessage}
                </p>
              ) : null}

              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Checking…" : "Continue"}
              </Button>
            </form>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={handleCodeSubmit}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="code">Authenticator code</Label>
                <Input
                  id="code"
                  name="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={TOTP_CODE_LENGTH}
                  required
                  autoFocus
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                />
              </div>

              {errorMessage ? (
                <p className="text-destructive text-sm" role="alert">
                  {errorMessage}
                </p>
              ) : null}

              <Button type="submit" disabled={isSubmitting || code.length !== TOTP_CODE_LENGTH}>
                {isSubmitting ? "Checking…" : "Sign in"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
