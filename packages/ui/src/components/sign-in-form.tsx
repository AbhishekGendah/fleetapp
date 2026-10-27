"use client";

import { useState } from "react";

import { Button } from "./button";
import { ClientForm, SubmitButton } from "./client-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";
import { FormError } from "./form-message";
import { Input, Label } from "./input";

const TOTP_CODE_LENGTH = 6;

/**
 * Deliberately vague, and the same whatever went wrong. Telling someone which
 * half they got right tells an attacker which emails exist.
 */
const SIGN_IN_FAILED_MESSAGE = "That email address and password did not match.";
const CODE_FAILED_MESSAGE = "That code was not right. Check your authenticator app and try again.";
const RECOVERY_CODE_FAILED_MESSAGE = "That recovery code was not right, or has been used.";

export type PasswordStepResult = "needs_code" | "signed_in" | "refused";

export interface SignInFormProps {
  description: string;
  signInWithPassword(email: string, password: string): Promise<PasswordStepResult>;
  verifyCode(code: string, shouldTrustDevice: boolean): Promise<boolean>;
  verifyRecoveryCode(code: string, shouldTrustDevice: boolean): Promise<boolean>;
  /** Shown as a tickbox on the code step. Left out, the device is never trusted. */
  trustDeviceLabel?: string;
  forgotPasswordHref?: string;
  onSignedIn(): void;
}

type Step = "password" | "code" | "recovery-code";

/** Runs a submit, tracking whether it is in flight and what went wrong. */
function useSubmission() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function run<Result>(
    attempt: () => Promise<Result>,
    isSuccess: (result: Result) => boolean,
    failureMessage: string,
  ): Promise<Result> {
    setErrorMessage(null);
    setIsSubmitting(true);
    const result = await attempt();
    setIsSubmitting(false);
    if (!isSuccess(result)) {
      setErrorMessage(failureMessage);
    }
    return result;
  }

  return { errorMessage, isSubmitting, run };
}

export function SignInForm(props: SignInFormProps) {
  const [step, setStep] = useState<Step>("password");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            {step === "password"
              ? props.description
              : step === "code"
                ? "Enter the 6-digit code from your authenticator app."
                : "Enter one of the recovery codes you saved when you set up your authenticator."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === "password" ? (
            <PasswordStep {...props} onNeedsCode={() => setStep("code")} />
          ) : (
            <CodeStep
              {...props}
              isRecoveryCode={step === "recovery-code"}
              onSwitch={() => setStep(step === "code" ? "recovery-code" : "code")}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function PasswordStep(props: SignInFormProps & { onNeedsCode(): void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { errorMessage, isSubmitting, run } = useSubmission();

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const result = await run(
      () => props.signInWithPassword(email, password),
      (outcome) => outcome !== "refused",
      SIGN_IN_FAILED_MESSAGE,
    );

    if (result === "refused") {
      setPassword("");
    } else if (result === "needs_code") {
      props.onNeedsCode();
    } else {
      props.onSignedIn();
    }
  }

  return (
    <ClientForm className="flex flex-col gap-4" onSubmit={handleSubmit}>
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
      <FormError message={errorMessage} />
      <SubmitButton disabled={isSubmitting}>{isSubmitting ? "Checking…" : "Continue"}</SubmitButton>
      {props.forgotPasswordHref ? (
        <a href={props.forgotPasswordHref} className="text-center text-sm hover:underline">
          Forgot your password?
        </a>
      ) : null}
    </ClientForm>
  );
}

interface CodeStepProps extends SignInFormProps {
  isRecoveryCode: boolean;
  onSwitch(): void;
}

function CodeStep(props: CodeStepProps) {
  const [code, setCode] = useState("");
  const [shouldTrustDevice, setShouldTrustDevice] = useState(false);
  const { errorMessage, isSubmitting, run } = useSubmission();

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const isSuccessful = await run(
      () =>
        props.isRecoveryCode
          ? props.verifyRecoveryCode(code.trim(), shouldTrustDevice)
          : props.verifyCode(code, shouldTrustDevice),
      (isVerified) => isVerified,
      props.isRecoveryCode ? RECOVERY_CODE_FAILED_MESSAGE : CODE_FAILED_MESSAGE,
    );
    if (isSuccessful) {
      props.onSignedIn();
      return;
    }
    setCode("");
  }

  const isCodeComplete = props.isRecoveryCode
    ? code.trim().length > 0
    : code.length === TOTP_CODE_LENGTH;

  return (
    <ClientForm className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="code">
          {props.isRecoveryCode ? "Recovery code" : "Authenticator code"}
        </Label>
        <Input
          id="code"
          name="code"
          type="text"
          inputMode={props.isRecoveryCode ? "text" : "numeric"}
          autoComplete="one-time-code"
          maxLength={props.isRecoveryCode ? undefined : TOTP_CODE_LENGTH}
          required
          autoFocus
          value={code}
          onChange={(event) =>
            setCode(
              props.isRecoveryCode ? event.target.value : event.target.value.replace(/\D/g, ""),
            )
          }
        />
      </div>
      {props.trustDeviceLabel ? (
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={shouldTrustDevice}
            onChange={(event) => setShouldTrustDevice(event.target.checked)}
          />
          {props.trustDeviceLabel}
        </label>
      ) : null}
      <FormError message={errorMessage} />
      <SubmitButton disabled={isSubmitting || !isCodeComplete}>
        {isSubmitting ? "Checking…" : "Sign in"}
      </SubmitButton>
      <Button type="button" variant="link" onClick={props.onSwitch}>
        {props.isRecoveryCode
          ? "Use my authenticator app instead"
          : "Lost your phone? Use a recovery code"}
      </Button>
    </ClientForm>
  );
}
