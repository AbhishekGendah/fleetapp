import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";

import type { CodeStore } from "./drizzle-code-store";
import { EMAIL_SIGN_IN_PATH, VERIFY_CODE_PATH } from "./paths";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

const VERIFY_RECOVERY_CODE_PATH = "/two-factor/verify-backup-code";
/** Better Auth's cookie that carries a half-done sign-in (password right, code still to come). */
const TWO_FACTOR_COOKIE_NAME = "two_factor";
/** What Better Auth answers once five wrong codes have locked the login. */
const CODE_LOCK_ERROR = "ACCOUNT_TEMPORARILY_LOCKED";

/**
 * The login actions the two apps actually use. Every other one Better Auth
 * offers is refused (review A2-1, A9-2): turning the authenticator off,
 * showing its set-up code again, making new recovery codes, changing the
 * password or email while signed in, deleting the login. A browser that
 * saved the password could otherwise do any of them unseen. A password is
 * changed only through the reset email, which proves the inbox.
 */
const USED_LOGIN_PATHS: ReadonlySet<string> = new Set([
  EMAIL_SIGN_IN_PATH,
  "/sign-out",
  "/get-session",
  "/list-sessions",
  "/revoke-session",
  "/request-password-reset",
  "/reset-password",
  "/reset-password/:token",
  "/two-factor/enable",
  VERIFY_CODE_PATH,
  VERIFY_RECOVERY_CODE_PATH,
  "/ok",
  "/error",
]);

const CODE_PATHS: ReadonlySet<string> = new Set([VERIFY_CODE_PATH, VERIFY_RECOVERY_CODE_PATH]);
/**
 * Reading or ending a sign-in is never refused here: each app's own guard
 * (requireUser, requireAdmin) turns a switched-off login away with a
 * message, and ending a sign-in must always work.
 */
const SESSION_ONLY_PATHS: ReadonlySet<string> = new Set([
  "/get-session",
  "/list-sessions",
  "/revoke-session",
  "/sign-out",
]);
const SIGN_IN_PATHS: ReadonlySet<string> = new Set([EMAIL_SIGN_IN_PATH, ...CODE_PATHS]);

export interface LoginGuardOptions {
  /** A full sign-in: after the authenticator code, or the password alone before one is set up. */
  onSignedIn: (userId: string, ipAddress: string | null) => Promise<void>;
  /** A wrong authenticator or recovery code. */
  onCodeFailed: (userId: string) => Promise<void>;
  /** Five wrong codes locked the login. */
  onCodeLockedOut: (userId: string) => Promise<void>;
  /**
   * Whether this login may still use the login system at all (not switched
   * off, its business not paused). Checked for every action made while
   * signed in, so a switched-off account can't change anything (review A9-5).
   */
  isAllowed: (userId: string) => Promise<boolean>;
  /** Remembers the last code typed: one is never accepted twice (review A2-7). */
  codeStore: CodeStore;
  /**
   * How long "remember this device" lasts from when a code was last typed
   * (review A2-9); left out where devices are never remembered (Admins).
   * Past it, `forgetDevices` is called before the password step, so the
   * code is asked for again.
   */
  rememberedDevice?: { days: number; forgetDevices: (userId: string) => Promise<void> };
  now?: () => Date;
}

interface HookContext {
  path?: string;
  body?: unknown;
  getSignedCookie(name: string, secret: string): Promise<string | null | false>;
  context: {
    secret: string;
    createAuthCookie(name: string): { name: string };
    internalAdapter: {
      findVerificationValue(identifier: string): Promise<{ value: string } | null>;
      findUserByEmail(email: string): Promise<{ user: { id: string } } | null>;
    };
  };
}

/** The code typed, if the request carries one as text. */
function typedCode(body: unknown): string | null {
  const code: unknown =
    typeof body === "object" && body !== null ? Reflect.get(body, "code") : undefined;
  return typeof code === "string" ? code : null;
}

/** The email typed at the password step, lower-cased as Better Auth stores it. */
function typedEmail(body: unknown): string | null {
  const email: unknown =
    typeof body === "object" && body !== null ? Reflect.get(body, "email") : undefined;
  return typeof email === "string" ? email.toLowerCase() : null;
}

/** What Better Auth answers for a wrong code: a code used already gets the same answer. */
const INVALID_CODE = { code: "INVALID_CODE", message: "Invalid code" } as const;

/**
 * Who is typing a code: from the half-done sign-in's cookie, as Better
 * Auth itself finds them. Null once that sign-in is used up or gone.
 */
async function codeUserId(ctx: HookContext): Promise<string | null> {
  const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE_NAME);
  const signed = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (!signed) {
    return null;
  }
  const pending = await ctx.context.internalAdapter.findVerificationValue(signed);
  return pending?.value ?? null;
}

/**
 * Narrows what the login system answers to what the apps use, and records
 * sign-ins truthfully (review A2-5, A9-1): once, only once the person is
 * fully in, and every wrong code and code lock as well.
 */
export function loginGuard(options: LoginGuardOptions): BetterAuthPlugin {
  const now = options.now ?? (() => new Date());
  // Who a code check is for, found before Better Auth can use the half-done
  // sign-in up, keyed by that request's own cookie value.
  const codeChecks = new Map<string, string>();
  const codeCheckKey = async (ctx: HookContext): Promise<string | null> => {
    const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE_NAME);
    const signed = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
    return signed || null;
  };

  return {
    id: "login-guard",
    hooks: {
      before: [
        {
          matcher: () => true,
          handler: createAuthMiddleware(async (ctx) => {
            if (!USED_LOGIN_PATHS.has(ctx.path ?? "")) {
              throw APIError.from("NOT_FOUND", { code: "NOT_FOUND", message: "Not found" });
            }
            const isChecked =
              !SIGN_IN_PATHS.has(ctx.path ?? "") && !SESSION_ONLY_PATHS.has(ctx.path ?? "");
            const session = isChecked ? await getSessionFromCtx(ctx).catch(() => null) : null;
            if (session && !(await options.isAllowed(session.user.id))) {
              throw APIError.from("FORBIDDEN", {
                code: "LOGIN_NOT_ALLOWED",
                message: "This login can't be used",
              });
            }
          }),
        },
        {
          matcher: (ctx) => CODE_PATHS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const key = await codeCheckKey(ctx);
            const userId = key ? await codeUserId(ctx) : null;
            if (!key || !userId) {
              return;
            }
            codeChecks.set(key, userId);
            const code = ctx.path === VERIFY_CODE_PATH ? typedCode(ctx.body) : null;
            if (code && (await options.codeStore.wasJustUsed(userId, code, now()))) {
              // Seen over a shoulder and typed again: refused like a wrong code.
              throw APIError.from("UNAUTHORIZED", INVALID_CODE);
            }
          }),
        },
        {
          matcher: (ctx) =>
            ctx.path === EMAIL_SIGN_IN_PATH && options.rememberedDevice !== undefined,
          handler: createAuthMiddleware(async (ctx) => {
            const remembered = options.rememberedDevice;
            const email = typedEmail(ctx.body);
            const found = email ? await ctx.context.internalAdapter.findUserByEmail(email) : null;
            if (!remembered || !found) {
              return;
            }
            const lastCodeAt = await options.codeStore.lastCodeAt(found.user.id);
            const isExpired =
              !lastCodeAt ||
              now().getTime() - lastCodeAt.getTime() > remembered.days * MILLISECONDS_PER_DAY;
            if (isExpired) {
              await remembered.forgetDevices(found.user.id);
            }
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) => SIGN_IN_PATHS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const returned: unknown = ctx.context.returned;
            const key = CODE_PATHS.has(ctx.path ?? "") ? await codeCheckKey(ctx) : null;
            const codeUser = key ? codeChecks.get(key) : undefined;
            if (key) {
              codeChecks.delete(key);
            }
            if (isAPIError(returned)) {
              if (codeUser) {
                await options.onCodeFailed(codeUser);
                if (returned.body?.code === CODE_LOCK_ERROR) {
                  await options.onCodeLockedOut(codeUser);
                }
              }
              return;
            }
            if (CODE_PATHS.has(ctx.path ?? "")) {
              const codeOwner =
                codeUser ?? (await getSessionFromCtx(ctx).catch(() => null))?.user.id;
              if (codeOwner) {
                await options.codeStore.noteCodeTyped(
                  codeOwner,
                  ctx.path === VERIFY_CODE_PATH ? typedCode(ctx.body) : null,
                  now(),
                );
              }
            }
            const signedIn = ctx.context.newSession;
            // The password step with an authenticator to come is not a sign-in yet;
            // nor is confirming a newly set-up authenticator while already signed in.
            const isHalfDone =
              ctx.path === EMAIL_SIGN_IN_PATH &&
              Boolean(Reflect.get(signedIn?.user ?? {}, "twoFactorEnabled"));
            const isEnrolment = CODE_PATHS.has(ctx.path ?? "") && !codeUser;
            if (signedIn && !isHalfDone && !isEnrolment) {
              await options.onSignedIn(signedIn.user.id, signedIn.session.ipAddress ?? null);
            }
          }),
        },
      ],
    },
  };
}
