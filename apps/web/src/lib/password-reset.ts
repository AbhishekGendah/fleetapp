import { describeErrorForLog, joinUrl } from "@fleetapp/core";
import type { SignInLockoutStore } from "@fleetapp/auth";
import type { AnyDatabase } from "@fleetapp/db/client";
import { ACTIVITY_ACTIONS, userVerifications } from "@fleetapp/db/schema";
import {
  renderPasswordChangedEmail,
  renderPasswordResetEmail,
  type EmailSender,
} from "@fleetapp/email";
import { eq } from "drizzle-orm";

import { RESET_LINK_LIFETIME_SECONDS, RESET_LINK_LIFETIME_WORDS } from "./password-reset-policy";
import { FORGOT_PASSWORD_PATH, RESET_PASSWORD_PATH } from "./paths";
import { isAllowedToSignIn } from "./sign-in-eligibility";
import type { RecordUserActivity } from "./user-activity";

export function buildResetPasswordUrl(appUrl: string, token: string): string {
  return `${joinUrl(appUrl, RESET_PASSWORD_PATH)}?token=${encodeURIComponent(token)}`;
}

/**
 * Makes every browser that was told to "remember this device" ask for the
 * authenticator code again. Without it, someone who got into a User's email
 * and sat at a remembered computer could reset the password and walk in with
 * no code at all.
 *
 * Better Auth keeps each remembered device as a verification record whose
 * value is the User's ID. Any other such record (an unused reset link) is
 * worth throwing away at this point too.
 */
async function forgetRememberedDevices(database: AnyDatabase, userId: string): Promise<void> {
  await database.delete(userVerifications).where(eq(userVerifications.value, userId));
}

export interface PasswordResetDependencies {
  database: AnyDatabase;
  emailSender: EmailSender;
  appUrl: string;
  lockoutStore: SignInLockoutStore;
  record: RecordUserActivity;
}

/** One step after a reset; a failure is logged (never its details) and the rest go on. */
async function afterReset(step: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(`${step} after a password reset failed`, describeErrorForLog(error));
  }
}

interface ResetUser {
  id: string;
  email: string;
  name: string;
}

/**
 * Better Auth's password reset settings for Users.
 *
 * Better Auth answers "if that address has a login, we've sent a link"
 * whether or not it does. Sending stays quiet for the same reason: a
 * suspended Operator's User gets no email, and a failure to send is logged
 * rather than shown, so neither reveals anything about the address.
 */
export interface PasswordResetOptions {
  resetPasswordTokenExpiresIn: number;
  revokeSessionsOnPasswordReset: boolean;
  sendResetPassword: (data: { user: ResetUser; token: string }) => Promise<void>;
  onPasswordReset: (data: { user: ResetUser }) => Promise<void>;
}

export function createPasswordResetOptions(deps: PasswordResetDependencies): PasswordResetOptions {
  return {
    resetPasswordTokenExpiresIn: RESET_LINK_LIFETIME_SECONDS,
    // Whoever had the old password is signed out everywhere.
    revokeSessionsOnPasswordReset: true,

    sendResetPassword: async ({ user, token }: { user: ResetUser; token: string }) => {
      try {
        if (!(await isAllowedToSignIn(deps.database, user.id))) {
          return;
        }
        const message = await renderPasswordResetEmail({
          to: user.email,
          name: user.name,
          resetUrl: buildResetPasswordUrl(deps.appUrl, token),
          validFor: RESET_LINK_LIFETIME_WORDS,
        });
        await deps.emailSender.send(message);
      } catch (error) {
        // Never the error itself: a provider's message can quote the address.
        console.error("Failed to send a password reset email", describeErrorForLog(error));
      }
    },

    // Nothing here may throw: the login system signs every other browser out
    // only once this returns, so a database hiccup here must not stop that
    // (review A2-10). Each step's failure is logged instead.
    onPasswordReset: async ({ user }: { user: ResetUser }) => {
      await afterReset("Forgetting remembered devices", () =>
        forgetRememberedDevices(deps.database, user.id),
      );
      // A new password starts the wrong-password count afresh, so a User
      // locked out by a guesser can get back in by resetting.
      await afterReset("Clearing failed sign-ins", () => deps.lockoutStore.clearFailures(user.id));
      await deps.record(user.id, ACTIVITY_ACTIONS.passwordReset, "user");
      // A reset the owner didn't make is seen (review A2-1).
      await afterReset("Emailing a password change", async () =>
        deps.emailSender.send(
          await renderPasswordChangedEmail({
            to: user.email,
            name: user.name,
            resetPasswordUrl: joinUrl(deps.appUrl, FORGOT_PASSWORD_PATH),
          }),
        ),
      );
    },
  };
}
