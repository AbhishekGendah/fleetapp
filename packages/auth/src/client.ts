"use client";

import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * The browser half of both login systems. No base URL: each app serves its
 * own auth routes, so a relative path works on localhost, on a preview
 * deployment and in production alike. Each app bundles its own copy, so
 * the two never share a session.
 */
export const authClient = createAuthClient({
  plugins: [twoFactorClient()],
});

/** What the first sign-in step leads to. The sign-in screen takes these too. */
export type PasswordStepResult = "refused" | "needs_code" | "signed_in";

export interface AuthenticatorEnrolment {
  totpURI: string;
  backupCodes: string[];
}

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<PasswordStepResult> {
  const { data, error } = await authClient.signIn.email({ email, password });
  if (error) {
    return "refused";
  }
  // A trusted device skips the code; otherwise every login has one to enter.
  return data && "twoFactorRedirect" in data && data.twoFactorRedirect ? "needs_code" : "signed_in";
}

export async function verifyAuthenticatorCode(
  code: string,
  shouldTrustDevice = false,
): Promise<boolean> {
  const { error } = await authClient.twoFactor.verifyTotp({ code, trustDevice: shouldTrustDevice });
  return !error;
}

export async function verifyRecoveryCode(
  code: string,
  shouldTrustDevice = false,
): Promise<boolean> {
  const { error } = await authClient.twoFactor.verifyBackupCode({
    code,
    trustDevice: shouldTrustDevice,
  });
  return !error;
}

/** Starts enrolment: the QR code's address and the recovery codes, or null if the password was wrong. */
export async function enableAuthenticator(
  password: string,
): Promise<AuthenticatorEnrolment | null> {
  const { data, error } = await authClient.twoFactor.enable({ password });
  if (error || !data || !("totpURI" in data)) {
    return null;
  }
  return { totpURI: data.totpURI, backupCodes: data.backupCodes };
}

export async function signOut(): Promise<void> {
  await authClient.signOut();
}
