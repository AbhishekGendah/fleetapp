import { SECONDS_PER_MINUTE } from "@fleetapp/core";
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
