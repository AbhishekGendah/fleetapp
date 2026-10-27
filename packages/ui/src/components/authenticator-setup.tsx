"use client";

import QRCode from "qrcode";
import { useState } from "react";

import { AuthPageLayout } from "./auth-page-layout";
import { Button } from "./button";
import { ClientForm, SubmitButton } from "./client-form";
import { CodeInput } from "./code-input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./card";
import { FormError } from "./form-message";
import { Input, Label } from "./input";

const TOTP_CODE_LENGTH = 6;
const QR_CODE_WIDTH_PX = 240;

const PASSWORD_FAILED_MESSAGE = "That password was not right.";
const CODE_FAILED_MESSAGE = "That code was not right. Wait for the next one and try again.";

export interface AuthenticatorEnrolment {
  totpURI: string;
  backupCodes: string[];
}

export interface AuthenticatorSetupProps {
  /** Shown beside the logo, e.g. "Admin". */
  logoLabel?: string;
  /** Starts enrolment. Null if the password was wrong. */
  enableAuthenticator(password: string): Promise<AuthenticatorEnrolment | null>;
  verifyCode(code: string): Promise<boolean>;
  onFinish(): void;
}

interface ScanDetails {
  qrCodeDataUrl: string;
  manualKey: string | null;
  recoveryCodes: string[];
}

type Step = "password" | "scan" | "recovery-codes";

const STEP_DESCRIPTIONS: Record<Step, string> = {
  password: "You will need a code from this app every time you sign in.",
  scan: "Scan this with Google Authenticator, 1Password, or any authenticator app.",
  "recovery-codes": "Save these somewhere safe. They are your way back in if you lose your phone.",
};

async function toScanDetails(enrolment: AuthenticatorEnrolment): Promise<ScanDetails> {
  return {
    qrCodeDataUrl: await QRCode.toDataURL(enrolment.totpURI, { width: QR_CODE_WIDTH_PX }),
    manualKey: new URL(enrolment.totpURI.replace("otpauth://", "https://")).searchParams.get(
      "secret",
    ),
    recoveryCodes: enrolment.backupCodes,
  };
}

/**
 * Enrolling an authenticator app, in three steps: confirm the password, scan
 * the code and prove it works, then write down the recovery codes.
 *
 * The recovery codes are shown once and never again — they are the way back in
 * if the phone is lost, so the last step will not move on until they have been
 * acknowledged.
 */
export function AuthenticatorSetup(props: AuthenticatorSetupProps) {
  const [step, setStep] = useState<Step>("password");
  const [scanDetails, setScanDetails] = useState<ScanDetails | null>(null);

  async function handleEnrolled(enrolment: AuthenticatorEnrolment): Promise<void> {
    setScanDetails(await toScanDetails(enrolment));
    setStep("scan");
  }

  return (
    <AuthPageLayout label={props.logoLabel}>
      <Card>
        <CardHeader>
          <CardTitle>Set up your authenticator app</CardTitle>
          <CardDescription>{STEP_DESCRIPTIONS[step]}</CardDescription>
        </CardHeader>
        <CardContent>
          {step === "password" ? (
            <ConfirmPasswordStep
              enableAuthenticator={props.enableAuthenticator}
              onEnrolled={handleEnrolled}
            />
          ) : null}
          {step === "scan" && scanDetails ? (
            <ScanStep
              details={scanDetails}
              verifyCode={props.verifyCode}
              onVerified={() => setStep("recovery-codes")}
            />
          ) : null}
          {step === "recovery-codes" && scanDetails ? (
            <RecoveryCodesStep codes={scanDetails.recoveryCodes} onFinish={props.onFinish} />
          ) : null}
        </CardContent>
      </Card>
    </AuthPageLayout>
  );
}

function ConfirmPasswordStep(props: {
  enableAuthenticator: AuthenticatorSetupProps["enableAuthenticator"];
  onEnrolled(enrolment: AuthenticatorEnrolment): Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);
    const enrolment = await props.enableAuthenticator(password);
    setIsSubmitting(false);
    setPassword("");

    if (!enrolment) {
      setErrorMessage(PASSWORD_FAILED_MESSAGE);
      return;
    }
    await props.onEnrolled(enrolment);
  }

  return (
    <ClientForm className="flex flex-col gap-4" onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Confirm your password</Label>
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
    </ClientForm>
  );
}

function ScanStep(props: {
  details: ScanDetails;
  verifyCode: AuthenticatorSetupProps["verifyCode"];
  onVerified(): void;
}) {
  const [code, setCode] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function verify(submittedCode: string): Promise<void> {
    if (isSubmitting) {
      return;
    }
    setErrorMessage(null);
    setIsSubmitting(true);
    const isVerified = await props.verifyCode(submittedCode);
    setIsSubmitting(false);
    setCode("");

    if (!isVerified) {
      setErrorMessage(CODE_FAILED_MESSAGE);
      return;
    }
    props.onVerified();
  }

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    void verify(code);
  }

  return (
    <ClientForm className="flex flex-col gap-4" onSubmit={handleSubmit}>
      {/* A plain img: a data URL made in the browser is nothing next/image can optimise. */}
      <img
        src={props.details.qrCodeDataUrl}
        alt="QR code for your authenticator app"
        width={QR_CODE_WIDTH_PX}
        height={QR_CODE_WIDTH_PX}
        className="mx-auto rounded-md bg-white p-2"
      />
      {props.details.manualKey ? (
        <p className="text-muted-foreground text-center text-xs break-all">
          Can&rsquo;t scan? Enter this key by hand:
          <br />
          <span className="font-mono">{props.details.manualKey}</span>
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor="code">Enter the 6-digit code it shows</Label>
        <CodeInput
          id="code"
          name="code"
          length={TOTP_CODE_LENGTH}
          value={code}
          onChange={setCode}
          onComplete={(completedCode) => void verify(completedCode)}
          isDisabled={isSubmitting}
        />
      </div>
      <FormError message={errorMessage} />
      <SubmitButton disabled={isSubmitting || code.length !== TOTP_CODE_LENGTH}>
        {isSubmitting ? "Checking…" : "Confirm"}
      </SubmitButton>
    </ClientForm>
  );
}

function RecoveryCodesStep(props: { codes: string[]; onFinish(): void }) {
  const [hasSavedCodes, setHasSavedCodes] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <ul className="bg-muted grid grid-cols-2 gap-2 rounded-md p-3 font-mono text-sm">
        {props.codes.map((recoveryCode) => (
          <li key={recoveryCode}>{recoveryCode}</li>
        ))}
      </ul>
      <p className="text-muted-foreground text-sm">
        Each code works once. You will not be shown them again.
      </p>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1 size-5"
          checked={hasSavedCodes}
          onChange={(event) => setHasSavedCodes(event.target.checked)}
        />
        I have saved these somewhere safe.
      </label>
      <Button onClick={props.onFinish} disabled={!hasSavedCodes}>
        Done
      </Button>
    </div>
  );
}
