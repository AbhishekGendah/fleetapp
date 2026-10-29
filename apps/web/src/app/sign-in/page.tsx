"use client";

import { SignInForm, type PasswordStepResult } from "@fleetapp/ui/sign-in-form";
import { useRouter } from "next/navigation";

import { authClient } from "../../lib/auth-client";
import { FORGOT_PASSWORD_PATH } from "../../lib/paths";
import { HOME_PATH } from "../../lib/paths";

async function signInWithPassword(email: string, password: string): Promise<PasswordStepResult> {
  const { data, error } = await authClient.signIn.email({ email, password });
  if (error) {
    return "refused";
  }
  // A trusted device skips the code; otherwise every User has one to enter.
  return data && "twoFactorRedirect" in data && data.twoFactorRedirect ? "needs_code" : "signed_in";
}

async function verifyCode(code: string, shouldTrustDevice: boolean): Promise<boolean> {
  const { error } = await authClient.twoFactor.verifyTotp({ code, trustDevice: shouldTrustDevice });
  return !error;
}

async function verifyRecoveryCode(code: string, shouldTrustDevice: boolean): Promise<boolean> {
  const { error } = await authClient.twoFactor.verifyBackupCode({
    code,
    trustDevice: shouldTrustDevice,
  });
  return !error;
}

export default function SignInPage() {
  const router = useRouter();

  function handleSignedIn(): void {
    router.push(HOME_PATH);
    router.refresh();
  }

  return (
    <SignInForm
      description="Sign in to manage your fleet."
      signInWithPassword={signInWithPassword}
      verifyCode={verifyCode}
      verifyRecoveryCode={verifyRecoveryCode}
      trustDeviceLabel="Remember this device for 14 days"
      forgotPasswordHref={FORGOT_PASSWORD_PATH}
      onSignedIn={handleSignedIn}
    />
  );
}
