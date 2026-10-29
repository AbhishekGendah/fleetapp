"use client";

import { SignInForm, type PasswordStepResult } from "@fleetapp/ui/sign-in-form";
import { useRouter } from "next/navigation";

import { authClient } from "../../lib/auth-client";
import { ADMIN_LABEL } from "../admin-label";
import { HOME_PATH } from "../../lib/paths";

async function signInWithPassword(email: string, password: string): Promise<PasswordStepResult> {
  const { data, error } = await authClient.signIn.email({ email, password });
  if (error) {
    return "refused";
  }
  // Every Admin has an authenticator app, so a right password always leads
  // to the code step rather than straight in.
  return data && "twoFactorRedirect" in data && data.twoFactorRedirect ? "needs_code" : "signed_in";
}

// No trusted devices for Admins: a code on every sign-in. See auth-options.ts.
async function verifyCode(code: string): Promise<boolean> {
  const { error } = await authClient.twoFactor.verifyTotp({ code });
  return !error;
}

async function verifyRecoveryCode(code: string): Promise<boolean> {
  const { error } = await authClient.twoFactor.verifyBackupCode({ code });
  return !error;
}

export default function SignInPage() {
  const router = useRouter();

  return (
    <SignInForm
      description="Altus Global Solutions platform admin."
      logoLabel={ADMIN_LABEL}
      signInWithPassword={signInWithPassword}
      verifyCode={verifyCode}
      verifyRecoveryCode={verifyRecoveryCode}
      onSignedIn={() => router.push(HOME_PATH)}
    />
  );
}
