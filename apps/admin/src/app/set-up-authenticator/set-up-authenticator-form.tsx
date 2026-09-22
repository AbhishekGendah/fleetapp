"use client";

import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { Input, Label } from "@fleetapp/ui/input";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useState } from "react";

import { authClient } from "../../lib/auth-client";

const TOTP_CODE_LENGTH = 6;
const QR_CODE_WIDTH_PX = 240;

const PASSWORD_FAILED_MESSAGE = "That password was not right.";
const CODE_FAILED_MESSAGE = "That code was not right. Wait for the next one and try again.";

type Step = "password" | "scan" | "recovery-codes";

/**
 * Enrolling an authenticator app, in three steps: confirm the password, scan
 * the code and prove it works, then write down the recovery codes.
 *
 * The recovery codes are shown once and never again — they are the way back in
 * if the phone is lost, so the last step will not move on until they have been
 * acknowledged.
 */
export function SetUpAuthenticatorForm() {
  const router = useRouter();

  const [step, setStep] = useState<Step>("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [hasSavedCodes, setHasSavedCodes] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handlePasswordSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    const { data, error } = await authClient.twoFactor.enable({ password });

    setIsSubmitting(false);
    setPassword("");

    if (error || !data || !("totpURI" in data)) {
      setErrorMessage(PASSWORD_FAILED_MESSAGE);
      return;
    }

    setRecoveryCodes(data.backupCodes);
    setQrCodeDataUrl(await QRCode.toDataURL(data.totpURI, { width: QR_CODE_WIDTH_PX }));
    setManualKey(
      new URL(data.totpURI.replace("otpauth://", "https://")).searchParams.get("secret"),
    );
    setStep("scan");
  }

  async function handleCodeSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    const { error } = await authClient.twoFactor.verifyTotp({ code });

    setIsSubmitting(false);
    setCode("");

    if (error) {
      setErrorMessage(CODE_FAILED_MESSAGE);
      return;
    }

    setStep("recovery-codes");
  }

  function handleFinish(): void {
    router.push("/");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Set up your authenticator app</CardTitle>
          <CardDescription>
            {step === "password"
              ? "You will need a code from this app every time you sign in."
              : step === "scan"
                ? "Scan this with Google Authenticator, 1Password, or any authenticator app."
                : "Save these somewhere safe. They are your way back in if you lose your phone."}
          </CardDescription>
        </CardHeader>

        <CardContent>
          {step === "password" ? (
            <form className="flex flex-col gap-4" onSubmit={handlePasswordSubmit}>
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

              {errorMessage ? (
                <p className="text-destructive text-sm" role="alert">
                  {errorMessage}
                </p>
              ) : null}

              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Checking…" : "Continue"}
              </Button>
            </form>
          ) : null}

          {step === "scan" ? (
            <form className="flex flex-col gap-4" onSubmit={handleCodeSubmit}>
              {qrCodeDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- a data URL generated in the browser, not a file next/image can optimise
                <img
                  src={qrCodeDataUrl}
                  alt="QR code for your authenticator app"
                  width={QR_CODE_WIDTH_PX}
                  height={QR_CODE_WIDTH_PX}
                  className="mx-auto rounded-md bg-white p-2"
                />
              ) : null}

              {manualKey ? (
                <p className="text-muted-foreground text-center text-xs break-all">
                  Can&rsquo;t scan? Enter this key by hand:
                  <br />
                  <span className="font-mono">{manualKey}</span>
                </p>
              ) : null}

              <div className="flex flex-col gap-2">
                <Label htmlFor="code">Enter the 6-digit code it shows</Label>
                <Input
                  id="code"
                  name="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={TOTP_CODE_LENGTH}
                  required
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
                {isSubmitting ? "Checking…" : "Confirm"}
              </Button>
            </form>
          ) : null}

          {step === "recovery-codes" ? (
            <div className="flex flex-col gap-4">
              <ul className="bg-muted grid grid-cols-2 gap-2 rounded-md p-3 font-mono text-sm">
                {recoveryCodes.map((recoveryCode) => (
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

              <Button onClick={handleFinish} disabled={!hasSavedCodes}>
                Done
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
