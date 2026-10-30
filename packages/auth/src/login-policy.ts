import {
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
  SECONDS_PER_MINUTE,
} from "@fleetapp/core";
import { z } from "zod";

/**
 * The rules both logins (Users and Admins) share. Nothing server-only in
 * here, so the browser can word its messages from the same numbers.
 */

/** Five wrong passwords in a row locks the login for fifteen minutes. */
export const MAX_FAILED_SIGN_INS = 5;
export const SIGN_IN_LOCKOUT_MINUTES = 15;

/** Long enough to matter, short enough that a passphrase still fits. */
export const MINIMUM_PASSWORD_LENGTH = 12;
export const MAXIMUM_PASSWORD_LENGTH = 128;

/** Wrong authenticator codes lock a login exactly as wrong passwords do. */
export const TWO_FACTOR_LOCKOUT = {
  enabled: true,
  maxFailedAttempts: MAX_FAILED_SIGN_INS,
  durationSeconds: SIGN_IN_LOCKOUT_MINUTES * SECONDS_PER_MINUTE,
} as const;

/** Recovery codes, shown once at enrolment and never again. */
export const RECOVERY_CODES = { amount: 10, length: 10 } as const;

export const PASSWORDS_DIFFER_MESSAGE = "The two passwords were not the same.";

/**
 * A new password typed twice, as on the invite and reset pages and in the
 * first-Admin command. The browser checks with this as you type; the server
 * (or the login system) checks again.
 */
export const newPasswordSchema = z
  .object({
    password: z
      .string()
      .min(MINIMUM_PASSWORD_LENGTH, `At least ${MINIMUM_PASSWORD_LENGTH} characters.`)
      .max(MAXIMUM_PASSWORD_LENGTH, `At most ${MAXIMUM_PASSWORD_LENGTH} characters.`),
    confirmation: z.string(),
  })
  .refine((input) => input.password === input.confirmation, {
    path: ["confirmation"],
    message: PASSWORDS_DIFFER_MESSAGE,
  });

export type NewPasswordInput = z.infer<typeof newPasswordSchema>;

/** Shown when a new password is found in known breaches. A warning: it may still be used. */
export const BREACHED_PASSWORD_WARNING =
  "This password has appeared in a data breach elsewhere, so people trying to break in may already have it. We recommend choosing a different one.";

/**
 * How long a sign-in lasts (approved by Abhi). Each has an inactivity window,
 * pushed back by every page opened, and a hard limit after which the person
 * signs in again however busy they have been.
 *
 * Users: a week without use, and 30 days at most. Operators work from their
 * phone all day, so a short timeout would make the app painful; their
 * authenticator and the new-device email protect them.
 * Admins: 30 minutes without use, and 8 hours at most. An Admin reaches
 * every Operator. (Relaxed while testing: see ADMIN_SESSION below.)
 */
export const USER_SESSION = {
  idleSeconds: 7 * SECONDS_PER_DAY,
  /** How often an active sign-in's end is pushed back. */
  refreshSeconds: SECONDS_PER_DAY,
  maxAgeSeconds: 30 * SECONDS_PER_DAY,
  maxAgeWords: "30 days",
} as const;

/** The approved Admin limits, to be used again at launch. */
export const ADMIN_SESSION_AT_LAUNCH = {
  idleSeconds: 30 * SECONDS_PER_MINUTE,
  refreshSeconds: 5 * SECONDS_PER_MINUTE,
  maxAgeSeconds: 8 * SECONDS_PER_HOUR,
  maxAgeWords: "8 hours",
} as const;

/**
 * TODO(before launch): set this back to ADMIN_SESSION_AT_LAUNCH. Relaxed on
 * Abhi's request (30 Oct 2026) while he tests every day: two weeks without
 * use and 30 days at most, as for Users. Listed in docs/launch-checklist.md.
 */
const ADMIN_SESSION_WHILE_TESTING = {
  idleSeconds: 14 * SECONDS_PER_DAY,
  refreshSeconds: SECONDS_PER_DAY,
  maxAgeSeconds: 30 * SECONDS_PER_DAY,
  maxAgeWords: "30 days",
} as const;

export const ADMIN_SESSION: {
  idleSeconds: number;
  refreshSeconds: number;
  maxAgeSeconds: number;
  maxAgeWords: string;
} = ADMIN_SESSION_WHILE_TESTING;

/** True once a sign-in is older than its hard limit, however active it has been. */
export function hasReachedSessionLimit(
  signedInAt: Date,
  now: Date,
  maxAgeSeconds: number,
): boolean {
  return now.getTime() - signedInAt.getTime() >= maxAgeSeconds * MILLISECONDS_PER_SECOND;
}

/** Added to the sign-in page's address when a sign-in was ended by its hard limit. */
export const SIGNED_OUT_REASON_PARAM = "signed-out";
export const SIGNED_OUT_TIME_LIMIT = "time-limit";

/** Where to send someone whose sign-in reached its hard limit. */
export function timeLimitSignInPath(signInPath: string): string {
  return `${signInPath}?${SIGNED_OUT_REASON_PARAM}=${SIGNED_OUT_TIME_LIMIT}`;
}

/** What the sign-in page says, from its address: why the person is back, if a time limit sent them. */
export function signInNotice(
  searchParams: Record<string, string | string[] | undefined>,
  session: { maxAgeWords: string },
): string | undefined {
  if (searchParams[SIGNED_OUT_REASON_PARAM] !== SIGNED_OUT_TIME_LIMIT) {
    return undefined;
  }
  return `For your security, you were signed out after ${session.maxAgeWords}. Sign in again to carry on.`;
}
