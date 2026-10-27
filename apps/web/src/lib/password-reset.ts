import type { SignInLockoutStore } from "@fleetapp/auth";
import type { AnyDatabase } from "@fleetapp/db/client";
import { ACTIVITY_ACTIONS } from "@fleetapp/db/schema";
import { renderPasswordResetEmail, type EmailSender } from "@fleetapp/email";

import { RESET_LINK_LIFETIME_SECONDS, RESET_LINK_LIFETIME_WORDS } from "./password-reset-policy";
import { absoluteUrl, RESET_PASSWORD_PATH } from "./paths";
import { isAllowedToSignIn } from "./sign-in-eligibility";
import type { RecordUserActivity } from "./user-activity";

export function buildResetPasswordUrl(appUrl: string, token: string): string {
  return `${absoluteUrl(appUrl, RESET_PASSWORD_PATH)}?token=${encodeURIComponent(token)}`;
}

export interface PasswordResetDependencies {
  database: AnyDatabase;
  emailSender: EmailSender;
  appUrl: string;
  lockoutStore: SignInLockoutStore;
  record: RecordUserActivity;
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
export function createPasswordResetOptions(deps: PasswordResetDependencies) {
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
        console.error("Failed to send a password reset email", {
          errorType: error instanceof Error ? error.name : typeof error,
        });
      }
    },

    // A new password starts the wrong-password count afresh, so a User locked
    // out by a guesser can get back in by resetting.
    onPasswordReset: async ({ user }: { user: ResetUser }) => {
      await deps.lockoutStore.clearFailures(user.id);
      await deps.record(user.id, ACTIVITY_ACTIONS.passwordReset, "user");
    },
  };
}
