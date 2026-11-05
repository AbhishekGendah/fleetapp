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

/**
 * What the first sign-in step leads to. The sign-in screen takes these too.
 * "paused": the right password, but the login may not sign in now (its
 * business paused, or an Admin switched off). "unreachable": the request
 * never got an answer (a dropped connection). "too_many": too many tries.
 */
export type PasswordStepResult =
  "refused" | "paused" | "unreachable" | "too_many" | "needs_code" | "signed_in";

/** What an authenticator or recovery code step leads to. */
export type CodeStepResult =
  "verified" | "wrong" | "locked" | "expired" | "unreachable" | "too_many";

export interface AuthenticatorEnrolment {
  totpURI: string;
  backupCodes: string[];
}

const TOO_MANY_REQUESTS_STATUS = 429;
/** Better Auth's answer when the right password's login may not sign in now. */
const LOGIN_PAUSED_CODE = "FAILED_TO_CREATE_SESSION";
/** Better Auth's answer once five wrong codes locked the login. */
const CODE_LOCK_CODE = "ACCOUNT_TEMPORARILY_LOCKED";
/**
 * Better Auth's answers once the half-done sign-in is over: its 10 minutes
 * ran out, or its own tries did. Only typing the password again helps.
 */
const SIGN_IN_OVER_CODES: ReadonlySet<string> = new Set([
  "INVALID_TWO_FACTOR_COOKIE",
  "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE",
]);

interface ClientError {
  status?: number;
  code?: string;
}

/** A request that got no answer at all, rather than a refusal (review A10-6). */
function isUnanswered(error: ClientError): boolean {
  return !error.status;
}

/** Runs a login request, turning a dropped connection into an answer instead of a stuck screen. */
async function answered<T>(
  request: () => Promise<{ data: T | null; error: ClientError | null }>,
): Promise<{ data: T | null; error: ClientError | null }> {
  try {
    return await request();
  } catch {
    return { data: null, error: {} };
  }
}

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<PasswordStepResult> {
  const { data, error } = await answered(() => authClient.signIn.email({ email, password }));
  if (error) {
    if (isUnanswered(error)) {
      return "unreachable";
    }
    if (error.status === TOO_MANY_REQUESTS_STATUS) {
      return "too_many";
    }
    return error.code === LOGIN_PAUSED_CODE ? "paused" : "refused";
  }
  // A trusted device skips the code; otherwise every login has one to enter.
  return data && "twoFactorRedirect" in data && data.twoFactorRedirect ? "needs_code" : "signed_in";
}

function codeStepResultOf(error: ClientError | null): CodeStepResult {
  if (!error) {
    return "verified";
  }
  if (isUnanswered(error)) {
    return "unreachable";
  }
  // The lock is answered with the same status as too many requests, so its code is read first.
  if (error.code === CODE_LOCK_CODE) {
    return "locked";
  }
  if (error.code && SIGN_IN_OVER_CODES.has(error.code)) {
    return "expired";
  }
  return error.status === TOO_MANY_REQUESTS_STATUS ? "too_many" : "wrong";
}

export async function verifyAuthenticatorCode(
  code: string,
  shouldTrustDevice = false,
): Promise<CodeStepResult> {
  const { error } = await answered(() =>
    authClient.twoFactor.verifyTotp({ code, trustDevice: shouldTrustDevice }),
  );
  return codeStepResultOf(error);
}

export async function verifyRecoveryCode(
  code: string,
  shouldTrustDevice = false,
): Promise<CodeStepResult> {
  const { error } = await answered(() =>
    authClient.twoFactor.verifyBackupCode({ code, trustDevice: shouldTrustDevice }),
  );
  return codeStepResultOf(error);
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

/** Whether a code just typed while setting up the authenticator is right. */
export async function isSetUpCodeRight(code: string): Promise<boolean> {
  return (await verifyAuthenticatorCode(code)) === "verified";
}
