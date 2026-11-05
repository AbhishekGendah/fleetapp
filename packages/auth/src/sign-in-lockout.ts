import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";

import { EMAIL_SIGN_IN_PATH } from "./paths";

/**
 * Exactly what Better Auth answers for a wrong password. A locked login gets
 * the same answer, so the lockout cannot be used to find out which emails
 * have logins.
 */
const INVALID_EMAIL_OR_PASSWORD = {
  code: "INVALID_EMAIL_OR_PASSWORD",
  message: "Invalid email or password",
} as const;

/**
 * Where the attempt count lives. Each app passes its own table. An attempt
 * is counted before its password is checked, so guesses sent all at once
 * cannot slip past the limit together.
 */
export interface SignInLockoutStore {
  /**
   * Counts an attempt; not allowed when the login is locked or has no
   * attempts left, and says whether this attempt is the one that locked it.
   */
  claimAttempt(userId: string, now: Date): Promise<{ isAllowed: boolean; isNowLocked: boolean }>;
  /** After a wrong password: locks the login if it has used its attempts; says whether this did. */
  lockIfOutOfAttempts(userId: string, now: Date): Promise<{ isNowLocked: boolean }>;
  clearFailures(userId: string): Promise<void>;
}

export interface SignInLockoutOptions {
  store: SignInLockoutStore;
  now?: () => Date;
  onSignInFailed?: (userId: string) => Promise<void>;
  onLockedOut?: (userId: string) => Promise<void>;
}

interface SignInContext {
  path?: string;
  body?: unknown;
  context: {
    internalAdapter: {
      findUserByEmail(email: string): Promise<{ user: { id: string } } | null>;
    };
  };
}

function emailFrom(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const email: unknown = Reflect.get(body, "email");
  return typeof email === "string" ? email.toLowerCase() : null;
}

async function findUserId(ctx: SignInContext): Promise<string | null> {
  const email = emailFrom(ctx.body);
  if (!email) {
    return null;
  }
  const found = await ctx.context.internalAdapter.findUserByEmail(email);
  return found?.user.id ?? null;
}

/**
 * Only a well-formed sign-in counts towards the five tries (review A2-6):
 * one missing its password, or with one that is not text, is refused by
 * Better Auth's own checks without using up a try.
 */
function isWellFormed(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof Reflect.get(body, "email") === "string" &&
    typeof Reflect.get(body, "password") === "string"
  );
}

/** The right password, but the login may not sign in (switched off, or its business paused). */
const REFUSED_AFTER_PASSWORD = "FAILED_TO_CREATE_SESSION";

function isWrongPassword(returned: unknown): boolean {
  return isAPIError(returned) && returned.body?.code === INVALID_EMAIL_OR_PASSWORD.code;
}

/**
 * Wrong-password lockout, kept in the database.
 *
 * Better Auth's own defence is a rate limit held in each server's memory,
 * which on Vercel resets constantly and is spread across many servers. This
 * keeps the count per login instead, so it holds however many servers there
 * are and however often they restart. Each attempt is counted before the
 * password is checked and a right password clears the count, so at most
 * five wrong guesses are ever checked before the login locks.
 */
export function signInLockout(options: SignInLockoutOptions): BetterAuthPlugin {
  const now = options.now ?? (() => new Date());
  const isEmailSignIn = (ctx: { path?: string }): boolean => ctx.path === EMAIL_SIGN_IN_PATH;

  return {
    id: "sign-in-lockout",
    hooks: {
      before: [
        {
          matcher: isEmailSignIn,
          handler: createAuthMiddleware(async (ctx) => {
            const userId = isWellFormed(ctx.body) ? await findUserId(ctx) : null;
            if (!userId) {
              return;
            }
            const { isAllowed, isNowLocked } = await options.store.claimAttempt(userId, now());
            if (isAllowed) {
              return;
            }
            if (isNowLocked) {
              // A lock is always recorded, however it was reached (review A2-6).
              await options.onLockedOut?.(userId);
            }
            // Hashing anyway keeps a locked login exactly as slow to answer
            // as a wrong password, so timing does not give the lockout away.
            await ctx.context.password.hash(String(Reflect.get(ctx.body ?? {}, "password") ?? ""));
            throw APIError.from("UNAUTHORIZED", INVALID_EMAIL_OR_PASSWORD);
          }),
        },
      ],
      after: [
        {
          matcher: isEmailSignIn,
          handler: createAuthMiddleware(async (ctx) => {
            const returned: unknown = ctx.context.returned;
            const isRefusedAfterPassword =
              isAPIError(returned) && returned.body?.code === REFUSED_AFTER_PASSWORD;
            if (isAPIError(returned) && !isWrongPassword(returned) && !isRefusedAfterPassword) {
              return;
            }
            const userId = isWellFormed(ctx.body) ? await findUserId(ctx) : null;
            if (!userId) {
              return;
            }

            if (!isWrongPassword(returned)) {
              await options.store.clearFailures(userId);
              return;
            }

            const { isNowLocked } = await options.store.lockIfOutOfAttempts(userId, now());
            await options.onSignInFailed?.(userId);
            if (isNowLocked) {
              await options.onLockedOut?.(userId);
            }
          }),
        },
      ],
    },
  };
}
