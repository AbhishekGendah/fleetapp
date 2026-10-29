"use client";

import type { PasswordStepResult } from "@fleetapp/auth/client";
import { useState } from "react";

import { AuthPageLayout } from "./auth-page-layout";
import { Button } from "./button";
import { ClientForm, SubmitButton } from "./client-form";
import { Checkbox } from "./checkbox";
import { CodeInput, TOTP_CODE_LENGTH } from "./code-input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";
import { FormError } from "./form-message";
import { FormField } from "./form-field";
import { CurrentPasswordField } from "./password-field";
import { Input, RequiredFieldsNote } from "./input";

/**
 * Deliberately vague, and the same whatever went wrong. Telling someone which
 * half they got right tells an attacker which emails exist.
 */
const SIGN_IN_FAILED_MESSAGE = "That email address and password did not match.";
const CODE_FAILED_MESSAGE = "That code was not right. Check your authenticator app and try again.";
const RECOVERY_CODE_FAILED_MESSAGE = "That recovery code was not right, or has been used.";

export interface SignInFormProps {
  description: string;
  /** Why they are here, e.g. signed out after a time limit. Shown in amber. */
  notice?: string;
  /** Shown beside the logo, e.g. "Admin". */
  logoLabel?: string;
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
    <AuthPageLayout label={props.logoLabel}>
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            {step === "password"
              ? props.description
              : step === "code"
                ? `Enter the ${TOTP_CODE_LENGTH}-digit code from your authenticator app.`
                : "Enter one of the recovery codes you saved when you set up your authenticator."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {props.notice && step === "password" ? (
            <p className="text-attention text-sm" role="status">
              {props.notice}
            </p>
          ) : null}
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
    </AuthPageLayout>
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
      <CurrentPasswordField label="Password" value={password} onValueChange={setPassword} />
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

  async function verify(submittedCode: string): Promise<void> {
    if (isSubmitting) {
      return;
    }
    const isSuccessful = await run(
      () =>
        props.isRecoveryCode
          ? props.verifyRecoveryCode(submittedCode.trim(), shouldTrustDevice)
          : props.verifyCode(submittedCode, shouldTrustDevice),
      (isVerified) => isVerified,
      props.isRecoveryCode ? RECOVERY_CODE_FAILED_MESSAGE : CODE_FAILED_MESSAGE,
    );
    if (isSuccessful) {
      props.onSignedIn();
      return;
    }
    setCode("");
  }

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    void verify(code);
  }

  const isCodeComplete = props.isRecoveryCode
    ? code.trim().length > 0
    : code.length === TOTP_CODE_LENGTH;

  return (
    <ClientForm className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <RequiredFieldsNote />
      <FormField
        htmlFor="code"
        label={props.isRecoveryCode ? "Recovery code" : "Authenticator code"}
        isRequired
      >
        {props.isRecoveryCode ? (
          <Input
            id="code"
            name="code"
            type="text"
            autoComplete="one-time-code"
            required
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        ) : (
          <CodeInput
            id="code"
            name="code"
            length={TOTP_CODE_LENGTH}
            autoFocus
            value={code}
            onChange={setCode}
            onComplete={(completedCode) => void verify(completedCode)}
            isDisabled={isSubmitting}
          />
        )}
      </FormField>
      {props.trustDeviceLabel ? (
        <Checkbox
          label={props.trustDeviceLabel}
          checked={shouldTrustDevice}
          onChange={(event) => setShouldTrustDevice(event.target.checked)}
        />
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
