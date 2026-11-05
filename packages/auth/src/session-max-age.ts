import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";

import { hasReachedSessionLimit } from "./login-policy";

/**
 * Paths that need no check here: signing in (no session yet), and reading
 * or ending the session, which each app's own guard (requireAdmin,
 * requireUser) already does at the limit.
 */
const UNCHECKED_PATHS: ReadonlySet<string> = new Set([
  "/sign-in/email",
  "/get-session",
  "/sign-out",
  // How each app's guard ends an over-age sign-in: refusing it here showed an
  // error page instead of the "please sign in again" message (review A2-4).
  "/revoke-session",
]);

/**
 * The hard limit on how long a sign-in lasts, however active, applied to
 * every endpoint of the login system itself (changing a password, listing or
 * ending sessions, switching off the authenticator). The app's pages check it
 * themselves; without this, those endpoints would accept a session past it
 * until the inactivity window ran out. An over-age session is ended for good.
 */
export function sessionMaxAge(options: {
  maxAgeSeconds: number;
  now?: () => Date;
}): BetterAuthPlugin {
  const now = options.now ?? (() => new Date());
  return {
    id: "session-max-age",
    hooks: {
      before: [
        {
          matcher: (ctx) => !UNCHECKED_PATHS.has(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const session = await getSessionFromCtx(ctx);
            if (
              !session ||
              !hasReachedSessionLimit(session.session.createdAt, now(), options.maxAgeSeconds)
            ) {
              return;
            }
            await ctx.context.internalAdapter.deleteSession(session.session.token);
            throw APIError.from("UNAUTHORIZED", {
              code: "SESSION_EXPIRED",
              message: "Session expired",
            });
          }),
        },
      ],
    },
  };
}
