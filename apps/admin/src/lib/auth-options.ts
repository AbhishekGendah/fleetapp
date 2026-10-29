import { SECONDS_PER_HOUR } from "@fleetapp/core";
import {
  ADMIN_ACTIVITY_ACTIONS,
  type AdminActivityAction,
  adminAccounts,
  adminSessions,
  adminTwoFactors,
  adminUsers,
  adminVerifications,
} from "@fleetapp/db/schema";
import {
  createDrizzleLockoutStore,
  MAXIMUM_PASSWORD_LENGTH,
  MINIMUM_PASSWORD_LENGTH,
  RECOVERY_CODES,
  signInLockout,
  TWO_FACTOR_LOCKOUT,
  VERIFY_CODE_PATH,
} from "@fleetapp/auth";
import type { AnyDatabase } from "@fleetapp/db/client";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins";

/** How long an Admin stays signed in before having to sign in again. */
const SESSION_DURATION_SECONDS = 8 * SECONDS_PER_HOUR;

/**
 * "Remember this device" is deliberately switched off for Admins: an Admin
 * account reaches every Operator's data, so an authenticator code is required
 * on every single sign-in.
 *
 * Zero is honoured rather than falling back to the library's 30-day default,
 * so a request that asks to be trusted anyway is handed an already-expired
 * trust and gets challenged again.
 */
const ADMIN_TRUST_DEVICE_MAX_AGE_SECONDS = 0;

export interface AdminAuthConfig {
  /** Anything that can run a query. Injected so the login flow can be tested. */
  database: AnyDatabase;
  baseURL: string;
  secret: string;
  /** Shown against the entry in an Admin's authenticator app. */
  issuerName: string;
  recordActivity: (entry: {
    adminUserId?: string | null;
    action: AdminActivityAction;
    ipAddress?: string | null;
  }) => Promise<void>;
  /** Injected so the tests can move the clock past a lockout. */
  now?: () => Date;
}

/**
 * The Admin login system's configuration.
 *
 * A factory rather than a constant so the database can be handed in: the app
 * passes a connection on `admin_auth_role`, and the tests pass one to a real
 * throwaway Postgres. What is under test is then the same configuration that
 * runs in production, mappings and all.
 *
 * The models Better Auth calls user/session/account/verification are the
 * `admin_*` tables, and its `userId` is our `adminUserId`. Field names map to
 * the Drizzle property, not the database column.
 */
function buildAdminAuthOptions(config: AdminAuthConfig) {
  return {
    appName: config.issuerName,
    baseURL: config.baseURL,
    secret: config.secret,

    database: drizzleAdapter(config.database, {
      provider: "pg",
      schema: {
        admin_users: adminUsers,
        admin_sessions: adminSessions,
        admin_accounts: adminAccounts,
        admin_verifications: adminVerifications,
        admin_two_factors: adminTwoFactors,
      },
    }),

    advanced: {
      // Matches the uuid columns the rest of the schema uses.
      database: { generateId: "uuid" as const },
    },

    user: { modelName: "admin_users", fields: { name: "fullName" } },
    session: {
      modelName: "admin_sessions",
      fields: { userId: "adminUserId" },
      expiresIn: SESSION_DURATION_SECONDS,
    },
    account: { modelName: "admin_accounts", fields: { userId: "adminUserId" } },
    verification: { modelName: "admin_verifications" },

    emailAndPassword: {
      enabled: true,
      minPasswordLength: MINIMUM_PASSWORD_LENGTH,
      maxPasswordLength: MAXIMUM_PASSWORD_LENGTH,
      // Admins are created by the first-admin command, never by signing up.
      disableSignUp: true,
    },

    plugins: [
      signInLockout({
        store: createDrizzleLockoutStore(config.database, {
          table: adminAccounts,
          userId: adminAccounts.adminUserId,
          providerId: adminAccounts.providerId,
          failedSignInCount: adminAccounts.failedSignInCount,
          signInLockedUntil: adminAccounts.signInLockedUntil,
        }),
        now: config.now,
        onSignInFailed: (adminUserId) =>
          config.recordActivity({ adminUserId, action: ADMIN_ACTIVITY_ACTIONS.signInFailed }),
        onLockedOut: (adminUserId) =>
          config.recordActivity({ adminUserId, action: ADMIN_ACTIVITY_ACTIONS.lockedOut }),
      }),
      twoFactor({
        issuer: config.issuerName,
        schema: {
          twoFactor: {
            modelName: "admin_two_factors",
            fields: { userId: "adminUserId" },
          },
        },
        backupCodeOptions: RECOVERY_CODES,
        // Tighter than the library's default, as for Users: an Admin reaches every Operator.
        accountLockout: TWO_FACTOR_LOCKOUT,
        trustDeviceMaxAge: ADMIN_TRUST_DEVICE_MAX_AGE_SECONDS,
      }),
    ],

    databaseHooks: {
      session: {
        create: {
          after: async (session: { userId: string; ipAddress?: string | null }) => {
            await config.recordActivity({
              adminUserId: session.userId,
              action: ADMIN_ACTIVITY_ACTIONS.signedIn,
              ipAddress: session.ipAddress,
            });
          },
        },
      },
      user: {
        update: {
          // The verify-code step changes an Admin only when it switches their
          // authenticator on, so an update there is the enrolment finishing.
          after: async (
            admin: { id: string; twoFactorEnabled?: boolean | null },
            context: { path?: string } | null,
          ) => {
            if (admin.twoFactorEnabled && context?.path === VERIFY_CODE_PATH) {
              await config.recordActivity({
                adminUserId: admin.id,
                action: ADMIN_ACTIVITY_ACTIONS.twoFactorEnrolled,
              });
            }
          },
        },
      },
    },
  };
}

/**
 * Builds the Admin login system. The app hands it a connection on
 * `admin_auth_role`; the tests hand it one to a throwaway Postgres.
 */
type AdminAuthOptions = ReturnType<typeof buildAdminAuthOptions>;
export type AdminAuth = ReturnType<typeof betterAuth<AdminAuthOptions>>;

export function createAdminAuth(config: AdminAuthConfig): AdminAuth {
  return betterAuth(buildAdminAuthOptions(config));
}
