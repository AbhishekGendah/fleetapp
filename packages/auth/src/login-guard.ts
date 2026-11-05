import { MILLISECONDS_PER_DAY } from "@fleetapp/core";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";

import type { CodeStore } from "./drizzle-code-store";
import { EMAIL_SIGN_IN_PATH, VERIFY_CODE_PATH } from "./paths";

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
  /** A full sign-in: after the authenticator code, on a remembered device, or before one is set up. */
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
      deleteSession(token: string): Promise<void>;
    };
  };
}

/** The code typed, if the request carries one as text. */
function typedCode(body: unknown): string | null {
  const code: unknown =
    typeof body === "object" && body !== null ? Reflect.get(body, "code") : undefined;
  return typeof code === "string" ? code : null;
}

/** What Better Auth answers for a wrong code: a code used already gets the same answer. */
const INVALID_CODE = { code: "INVALID_CODE", message: "Invalid code" } as const;

/**
 * Who is typing a code at sign-in: from the half-done sign-in's cookie, as
 * Better Auth itself finds them, read from this request alone. Null when
 * there is no half-done sign-in (setting up the authenticator) or it has
 * been used up.
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

/** The code-step answer to record: a wrong code, and the lock once it is set. */
async function recordCodeFailure(
  options: LoginGuardOptions,
  userId: string,
  errorCode: unknown,
  now: Date,
): Promise<void> {
  // Tried while already locked: the code wasn't even checked, and the lock is logged once.
  if (errorCode === CODE_LOCK_ERROR) {
    return;
  }
  await options.onCodeFailed(userId);
  if (await options.codeStore.isCodeLocked(userId, now)) {
    await options.onCodeLockedOut(userId);
  }
}

/** Whether the password step handed back "now the code", rather than signing in. */
function isWaitingForCode(returned: unknown): boolean {
  return (
    typeof returned === "object" &&
    returned !== null &&
    Reflect.get(returned, "twoFactorRedirect") === true
  );
}

/** The two halves of the login guard, each listed in its own place among the plugins. */
export interface LoginGuards {
  /**
   * Narrows what the login system answers to what the apps use. Listed
   * first, so a refused action never reaches another plugin.
   */
  guard: BetterAuthPlugin;
  /**
   * Records sign-ins truthfully (review A2-5, A9-1): once, only once the
   * person is fully in, and every wrong code and code lock as well. Listed
   * after the authenticator plugin, so it sees whether a password step
   * finished the sign-in (a remembered device) or is waiting for the code.
   */
  recorder: BetterAuthPlugin;
}

export function loginGuards(options: LoginGuardOptions): LoginGuards {
  const now = options.now ?? (() => new Date());
  return {
    guard: { id: "login-guard", hooks: { before: guardHooks(options, now) } },
    recorder: { id: "sign-in-recorder", hooks: { after: recorderHooks(options, now) } },
  };
}

type BeforeHooks = NonNullable<NonNullable<BetterAuthPlugin["hooks"]>["before"]>;
type AfterHooks = NonNullable<NonNullable<BetterAuthPlugin["hooks"]>["after"]>;

function guardHooks(options: LoginGuardOptions, now: () => Date): BeforeHooks {
  return [
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
      matcher: (ctx) => ctx.path === VERIFY_CODE_PATH,
      handler: createAuthMiddleware(async (ctx) => {
        const userId = await codeUserId(ctx);
        const code = typedCode(ctx.body);
        if (userId && code && (await options.codeStore.wasJustUsed(userId, code, now()))) {
          // Seen over a shoulder and typed again: refused, and logged, like a wrong code.
          await options.onCodeFailed(userId);
          throw APIError.from("UNAUTHORIZED", INVALID_CODE);
        }
      }),
    },
  ];
}

function recorderHooks(options: LoginGuardOptions, now: () => Date): AfterHooks {
  return [
    {
      matcher: (ctx) => ctx.path === EMAIL_SIGN_IN_PATH,
      handler: createAuthMiddleware(async (ctx) => {
        const signedIn = ctx.context.newSession;
        if (
          !signedIn ||
          isAPIError(ctx.context.returned) ||
          isWaitingForCode(ctx.context.returned)
        ) {
          return;
        }
        await options.onSignedIn(signedIn.user.id, signedIn.session.ipAddress ?? null);
      }),
    },
    {
      matcher: (ctx) => CODE_PATHS.has(ctx.path ?? ""),
      handler: createAuthMiddleware(async (ctx) => {
        const returned: unknown = ctx.context.returned;
        if (isAPIError(returned)) {
          const userId = await codeUserId(ctx);
          if (userId) {
            await recordCodeFailure(options, userId, returned.body?.code, now());
          }
          return;
        }
        const signedIn = ctx.context.newSession;
        const owner =
          signedIn?.user.id ?? (await getSessionFromCtx(ctx).catch(() => null))?.user.id;
        if (!owner) {
          return;
        }
        const code = ctx.path === VERIFY_CODE_PATH ? typedCode(ctx.body) : null;
        const isClaimed = await options.codeStore.claimCode(owner, code, now());
        if (!isClaimed && signedIn) {
          // The same code used at the same moment elsewhere: this sign-in is undone (review A2-7).
          await ctx.context.internalAdapter.deleteSession(signedIn.session.token);
          throw APIError.from("UNAUTHORIZED", INVALID_CODE);
        }
        // A sign-in finished by the code; setting up the authenticator while signed in isn't one.
        if (signedIn && (await isSignInChallenge(ctx))) {
          await options.onSignedIn(signedIn.user.id, signedIn.session.ipAddress ?? null);
        }
      }),
    },
  ];
}

/**
 * Whether the code finishes a sign-in: one typed at sign-in always comes with
 * the half-done sign-in's cookie; one typed while setting up the
 * authenticator (already signed in) never does.
 */
async function isSignInChallenge(ctx: HookContext): Promise<boolean> {
  const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE_NAME);
  return Boolean(await ctx.getSignedCookie(cookie.name, ctx.context.secret));
}

export interface RememberedDeviceExpiryOptions {
  codeStore: CodeStore;
  /** How long "remember this device" lasts from when a code was last typed (review A2-9). */
  days: number;
  /** Forgets the login's remembered devices only, never its reset links or half-done sign-ins. */
  forgetDevices: (userId: string) => Promise<void>;
  now?: () => Date;
}

/**
 * "Remember this device" lasts so many days from when a code was last
 * typed, not from each sign-in (review A2-9). Runs only after a right
 * password, and is listed before the authenticator plugin, so a device
 * past its time is forgotten before that plugin decides whether to ask
 * for the code. Before a right password, nothing is touched: a stranger
 * typing the email can't forget anything.
 */
export function rememberedDeviceExpiry(options: RememberedDeviceExpiryOptions): BetterAuthPlugin {
  const now = options.now ?? (() => new Date());
  return {
    id: "remembered-device-expiry",
    hooks: {
      after: [
        {
          matcher: (ctx) => ctx.path === EMAIL_SIGN_IN_PATH,
          handler: createAuthMiddleware(async (ctx) => {
            const signedIn = ctx.context.newSession;
            if (!signedIn || isAPIError(ctx.context.returned)) {
              return;
            }
            const lastCodeAt = await options.codeStore.lastCodeAt(signedIn.user.id);
            const isExpired =
              !lastCodeAt ||
              now().getTime() - lastCodeAt.getTime() > options.days * MILLISECONDS_PER_DAY;
            if (isExpired) {
              await options.forgetDevices(signedIn.user.id);
            }
          }),
        },
      ],
    },
  };
}
