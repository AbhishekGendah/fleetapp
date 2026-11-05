import {
  describeErrorForLog,
  joinUrl,
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_HOUR,
} from "@fleetapp/core";
import type { SignInLockoutStore } from "@fleetapp/auth";
import type { AnyDatabase } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  operatorInvites,
  passwordResetSends,
  userVerifications,
} from "@fleetapp/db/schema";
import {
  renderPasswordChangedEmail,
  renderPasswordResetEmail,
  type EmailSender,
} from "@fleetapp/email";
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";

import {
  RESET_EMAILS_PER_HOUR,
  RESET_LINK_LIFETIME_SECONDS,
  RESET_LINK_LIFETIME_WORDS,
} from "./password-reset-policy";
import { FORGOT_PASSWORD_PATH, RESET_PASSWORD_PATH } from "./paths";
import { isAllowedToSignIn } from "./sign-in-eligibility";
import type { RecordUserActivity } from "./user-activity";

/** Twice the longest-lived record that isn't a remembered device (a reset link), to be safe. */
const LONGEST_SHORT_RECORD_SECONDS = 2 * RESET_LINK_LIFETIME_SECONDS;

/** Keeps this lock apart from any other advisory lock taken on a login's ID. */
const RESET_COUNT_LOCK_PREFIX = "password-reset-count:";

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
 * value is the User's ID, as it does each reset link and half-done sign-in;
 * the records' names are stored as fingerprints, so they are told apart by
 * how long they last. Only a remembered device outlives the longest of the
 * others, so a reset link or half-done sign-in is never thrown away here
 * (review of batch 3: a sign-in must not undo a reset link just sent).
 */
export async function forgetRememberedDevices(
  database: AnyDatabase,
  userId: string,
  now: Date,
): Promise<void> {
  const outlivesOtherRecords = new Date(
    now.getTime() + LONGEST_SHORT_RECORD_SECONDS * MILLISECONDS_PER_SECOND,
  );
  await database
    .delete(userVerifications)
    .where(
      and(
        eq(userVerifications.value, userId),
        gt(userVerifications.expiresAt, outlivesOtherRecords),
      ),
    );
}

/**
 * Counts one more reset email for a login, if it has any left this hour;
 * false once it has had RESET_EMAILS_PER_HOUR (review G6-1).
 */
async function claimResetEmail(database: AnyDatabase, userId: string, now: Date): Promise<boolean> {
  const hourAgo = new Date(now.getTime() - SECONDS_PER_HOUR * MILLISECONDS_PER_SECOND);
  return database.transaction(async (tx) => {
    // One login's requests are counted one at a time, so a burst sent at once
    // can't all see room left (review of batch 3). Held until the transaction ends.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${RESET_COUNT_LOCK_PREFIX + userId}))`,
    );
    const [sent] = await tx
      .select({ total: count() })
      .from(passwordResetSends)
      .where(and(eq(passwordResetSends.userId, userId), gt(passwordResetSends.sentAt, hourAgo)));
    if ((sent?.total ?? 0) >= RESET_EMAILS_PER_HOUR) {
      return false;
    }
    await tx.insert(passwordResetSends).values({ userId, sentAt: now });
    return true;
  });
}

export interface PasswordResetDependencies {
  database: AnyDatabase;
  emailSender: EmailSender;
  appUrl: string;
  lockoutStore: SignInLockoutStore;
  record: RecordUserActivity;
  now?: () => Date;
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
        if (!(await claimResetEmail(deps.database, user.id, deps.now?.() ?? new Date()))) {
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
        forgetRememberedDevices(deps.database, user.id, deps.now?.() ?? new Date()),
      );
      // A new password starts the wrong-password count afresh, so a User
      // locked out by a guesser can get back in by resetting.
      await afterReset("Clearing failed sign-ins", () => deps.lockoutStore.clearFailures(user.id));
      // A reset before the invite was used sets the login up just the same (the
      // owner proved their inbox), so the invite counts as accepted (review A2-3).
      await afterReset("Marking the invite accepted", () =>
        deps.database
          .update(operatorInvites)
          .set({ acceptedAt: deps.now?.() ?? new Date() })
          .where(
            and(
              eq(operatorInvites.userId, user.id),
              isNull(operatorInvites.acceptedAt),
              isNull(operatorInvites.revokedAt),
            ),
          ),
      );
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
