import { createDrizzleLockoutStore, signInLockout, VERIFY_CODE_PATH } from "@fleetapp/auth";
import type { AnyDatabase } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  type ActivityAction,
  operators,
  userAccounts,
  users,
  userSessions,
  userTwoFactors,
  userVerifications,
} from "@fleetapp/db/schema";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";
import { eq } from "drizzle-orm";

import { recordUserActivity } from "./user-activity";

const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * How long a User stays signed in, and how often an active session's expiry
 * is pushed back. Operators use this every day on their phone; signing in
 * with a code every few hours would be the wrong trade.
 */
const SESSION_DURATION_SECONDS = 7 * SECONDS_PER_DAY;
const SESSION_REFRESH_SECONDS = SECONDS_PER_DAY;

/** "Remember this device": no authenticator code on it for 14 days. See docs/design/01. */
const TRUSTED_DEVICE_SECONDS = 14 * SECONDS_PER_DAY;

/** Same as Admins: five wrong codes, fifteen minutes. */
const MAX_FAILED_TWO_FACTOR_ATTEMPTS = 5;
const LOCKOUT_DURATION_SECONDS = 900;

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_LENGTH = 10;

export const MINIMUM_PASSWORD_LENGTH = 12;
export const MAXIMUM_PASSWORD_LENGTH = 128;

export interface UserAuthConfig {
  /** A connection on `web_auth_role`. Injected so the login flow can be tested. */
  database: AnyDatabase;
  baseURL: string;
  secret: string;
  issuerName: string;
  /** Added last. The app passes Next.js's cookie plugin; the tests pass nothing. */
  extraPlugins?: BetterAuthPlugin[];
  now?: () => Date;
}

/**
 * Whether a User may have a session at all: not archived, and their Operator
 * neither suspended nor archived. Checked when any session is created, so it
 * covers signing in, the authenticator step and accepting an invite alike.
 */
async function isAllowedToSignIn(database: AnyDatabase, userId: string): Promise<boolean> {
  const [row] = await database
    .select({
      userArchivedAt: users.archivedAt,
      operatorSuspendedAt: operators.suspendedAt,
      operatorArchivedAt: operators.archivedAt,
    })
    .from(users)
    .innerJoin(operators, eq(operators.id, users.operatorId))
    .where(eq(users.id, userId));

  return Boolean(row && !row.userArchivedAt && !row.operatorSuspendedAt && !row.operatorArchivedAt);
}

/**
 * The Operator login system's configuration: the Admin one's twin, over the
 * `user_*` tables.
 *
 * `operatorId` is exposed on the session's user, read by this role from the
 * User's own record. It is what the rest of the app scopes every query by
 * (rule 1), so it never comes from anything the browser sends.
 */
function buildUserAuthOptions(config: UserAuthConfig) {
  const record = (userId: string, action: ActivityAction, actorType: "user" | "system") =>
    recordUserActivity(config.database, { userId, action, actorType }).catch((error: unknown) => {
      // A missing history line must not be what stops someone signing in.
      // Logs the failure, never the entry: it names a User.
      console.error("Failed to write a sign-in to the activity log", error);
    });

  return {
    appName: config.issuerName,
    baseURL: config.baseURL,
    secret: config.secret,

    database: drizzleAdapter(config.database, {
      provider: "pg",
      schema: {
        users,
        user_sessions: userSessions,
        user_accounts: userAccounts,
        user_verifications: userVerifications,
        user_two_factors: userTwoFactors,
      },
    }),

    advanced: {
      database: { generateId: "uuid" as const },
    },

    user: {
      modelName: "users",
      fields: { name: "fullName" },
      additionalFields: {
        operatorId: { type: "string" as const, input: false, required: true },
      },
    },
    session: {
      modelName: "user_sessions",
      expiresIn: SESSION_DURATION_SECONDS,
      updateAge: SESSION_REFRESH_SECONDS,
    },
    account: { modelName: "user_accounts" },
    verification: {
      modelName: "user_verifications",
      // Password-reset tokens are stored as fingerprints, never as they are.
      storeIdentifier: "hashed" as const,
    },

    emailAndPassword: {
      enabled: true,
      minPasswordLength: MINIMUM_PASSWORD_LENGTH,
      maxPasswordLength: MAXIMUM_PASSWORD_LENGTH,
      // The only way to get a login is an invite from an Admin.
      disableSignUp: true,
    },

    plugins: [
      signInLockout({
        store: createDrizzleLockoutStore(config.database, {
          table: userAccounts,
          userId: userAccounts.userId,
          providerId: userAccounts.providerId,
          failedSignInCount: userAccounts.failedSignInCount,
          signInLockedUntil: userAccounts.signInLockedUntil,
        }),
        now: config.now,
        onSignInFailed: (userId) => record(userId, ACTIVITY_ACTIONS.signInFailed, "system"),
        onLockedOut: (userId) => record(userId, ACTIVITY_ACTIONS.lockedOut, "system"),
      }),
      twoFactor({
        issuer: config.issuerName,
        schema: { twoFactor: { modelName: "user_two_factors" } },
        backupCodeOptions: { amount: RECOVERY_CODE_COUNT, length: RECOVERY_CODE_LENGTH },
        accountLockout: {
          enabled: true,
          maxFailedAttempts: MAX_FAILED_TWO_FACTOR_ATTEMPTS,
          durationSeconds: LOCKOUT_DURATION_SECONDS,
        },
        trustDeviceMaxAge: TRUSTED_DEVICE_SECONDS,
      }),
      ...(config.extraPlugins ?? []),
    ],

    databaseHooks: {
      session: {
        create: {
          before: async (session: { userId: string }) => {
            const isAllowed = await isAllowedToSignIn(config.database, session.userId);
            return isAllowed ? undefined : false;
          },
          after: async (session: { userId: string }) => {
            await record(session.userId, ACTIVITY_ACTIONS.signedIn, "user");
          },
        },
      },
      user: {
        update: {
          // The verify-code step changes a User only when it switches their
          // authenticator on, so an update there is the enrolment finishing.
          // Checking the path keeps later updates of an enrolled User out.
          after: async (
            user: { id: string; twoFactorEnabled?: boolean | null },
            context: { path?: string } | null,
          ) => {
            if (user.twoFactorEnabled && context?.path === VERIFY_CODE_PATH) {
              await record(user.id, ACTIVITY_ACTIONS.twoFactorEnrolled, "user");
            }
          },
        },
      },
    },
  };
}

export function createUserAuth(config: UserAuthConfig) {
  return betterAuth(buildUserAuthOptions(config));
}

export type UserAuth = ReturnType<typeof createUserAuth>;
