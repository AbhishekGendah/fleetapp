import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";

/** Five wrong passwords in a row locks the login for fifteen minutes. */
export const MAX_FAILED_SIGN_INS = 5;
export const SIGN_IN_LOCKOUT_MINUTES = 15;

const EMAIL_SIGN_IN_PATH = "/sign-in/email";

/**
 * Exactly what Better Auth answers for a wrong password. A locked login gets
 * the same answer, so the lockout cannot be used to find out which emails
 * have logins.
 */
const INVALID_EMAIL_OR_PASSWORD = {
  code: "INVALID_EMAIL_OR_PASSWORD",
  message: "Invalid email or password",
} as const;

/** Where the wrong-password count lives. Each app passes its own table. */
export interface SignInLockoutStore {
  findLockedUntil(userId: string): Promise<Date | null>;
  /** Counts a wrong password; says whether that one started a lockout. */
  recordFailure(userId: string, now: Date): Promise<{ isNowLocked: boolean }>;
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

function isWrongPassword(returned: unknown): boolean {
  return isAPIError(returned) && returned.body?.code === INVALID_EMAIL_OR_PASSWORD.code;
}

/**
 * Wrong-password lockout, kept in the database.
 *
 * Better Auth's own defence is a rate limit held in each server's memory,
 * which on Vercel resets constantly and is spread across many servers. This
 * keeps the count per login instead, so it holds however many servers there
 * are and however often they restart.
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
            const userId = await findUserId(ctx);
            if (!userId) {
              return;
            }
            const lockedUntil = await options.store.findLockedUntil(userId);
            if (!lockedUntil || lockedUntil.getTime() <= now().getTime()) {
              return;
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
            if (isAPIError(returned) && !isWrongPassword(returned)) {
              return;
            }
            const userId = await findUserId(ctx);
            if (!userId) {
              return;
            }

            if (!isWrongPassword(returned)) {
              await options.store.clearFailures(userId);
              return;
            }

            const { isNowLocked } = await options.store.recordFailure(userId, now());
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
