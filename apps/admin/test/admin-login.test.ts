import { randomUUID } from "node:crypto";

import { adminActivityLog, adminUsers } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { createAdminAuth, type AdminAuth } from "../src/lib/auth-options";
import {
  AdminAlreadyExistsError,
  createFirstAdmin,
  WeakPasswordError,
} from "../src/lib/create-first-admin";

const TEST_PASSWORD = "a-long-enough-test-password";
const TEST_SECRET = "a-test-signing-secret-at-least-32-chars-long";
const TEST_BASE_URL = "http://localhost:3001";
const TEST_ISSUER = "Test Issuer";
const TOTP_DIGITS = 6;

/**
 * Exercises the real login configuration against a real Postgres.
 *
 * The thing most likely to be wrong in this slice is the mapping between what
 * Better Auth calls its models and what this schema calls its tables — and
 * that mapping fails silently everywhere except at the moment someone tries to
 * sign in. So these tests sign in.
 *
 * One file rather than two, and one Admin shared through it: these run against
 * one database, and "refuses to run a second time" only means something if
 * nothing else is creating Admins alongside it.
 */
describe("the admin login", () => {
  let connection: TestConnection;
  let auth: AdminAuth;
  let email: string;
  let adminUserId: string;

  beforeAll(async () => {
    connection = connectAs(inject("adminAuthRoleUrl"));

    auth = createAdminAuth({
      database: connection.db,
      baseURL: TEST_BASE_URL,
      secret: TEST_SECRET,
      issuerName: TEST_ISSUER,
      recordActivity: async (entry) => {
        await connection.db.insert(adminActivityLog).values({
          adminUserId: entry.adminUserId ?? null,
          action: entry.action,
          ipAddress: entry.ipAddress ?? null,
        });
      },
    });

    email = `${randomUUID()}@example.test`;
  });

  afterAll(async () => {
    await connection.close();
  });

  describe("creating the first Admin", () => {
    it("refuses a password that is too short", async () => {
      await expect(
        createFirstAdmin({
          database: connection.db,
          auth,
          email: `${randomUUID()}@example.test`,
          fullName: "Too Weak",
          password: "short",
        }),
      ).rejects.toBeInstanceOf(WeakPasswordError);
    });

    it("creates the Admin and logs it", async () => {
      const created = await createFirstAdmin({
        database: connection.db,
        auth,
        email,
        fullName: "The First Admin",
        password: TEST_PASSWORD,
      });
      adminUserId = created.adminUserId;

      const entries = await connection.db
        .select({ action: adminActivityLog.action })
        .from(adminActivityLog)
        .where(eq(adminActivityLog.adminUserId, adminUserId));

      expect(entries.map((entry) => entry.action)).toContain("created");
    });

    it("refuses to run a second time, and creates nothing when it does", async () => {
      const before = await connection.db.select({ id: adminUsers.id }).from(adminUsers);

      await expect(
        createFirstAdmin({
          database: connection.db,
          auth,
          email: `${randomUUID()}@example.test`,
          fullName: "A Second Admin",
          password: TEST_PASSWORD,
        }),
      ).rejects.toBeInstanceOf(AdminAlreadyExistsError);

      const after = await connection.db.select({ id: adminUsers.id }).from(adminUsers);

      expect(after.length).toBe(before.length);
    });
  });

  describe("signing in", () => {
    it("accepts the right password", async () => {
      const result = await auth.api.signInEmail({ body: { email, password: TEST_PASSWORD } });

      expect(result.user.email).toBe(email);
    });

    it("leaves an Admin without an authenticator short of admin access", async () => {
      // The password alone does create a session — but an Admin who has not
      // enrolled is not let into the app. requireAdmin() sends them to
      // enrolment, and this is the flag it reads to decide that.
      const [admin] = await connection.db
        .select({ twoFactorEnabled: adminUsers.twoFactorEnabled })
        .from(adminUsers)
        .where(eq(adminUsers.id, adminUserId));

      expect(admin?.twoFactorEnabled).toBe(false);
    });

    it("refuses the wrong password", async () => {
      await expect(
        auth.api.signInEmail({ body: { email, password: "not-the-right-password" } }),
      ).rejects.toThrow();
    });

    it("refuses an email that belongs to nobody", async () => {
      await expect(
        auth.api.signInEmail({
          body: { email: `${randomUUID()}@example.test`, password: TEST_PASSWORD },
        }),
      ).rejects.toThrow();
    });

    it("will not let anyone sign themselves up", async () => {
      await expect(
        auth.api.signUpEmail({
          body: {
            email: `${randomUUID()}@example.test`,
            password: TEST_PASSWORD,
            name: "Not Allowed",
          },
        }),
      ).rejects.toThrow();
    });

    it("writes a line to the Admin activity log", async () => {
      const entries = await connection.db
        .select({ action: adminActivityLog.action })
        .from(adminActivityLog)
        .where(eq(adminActivityLog.adminUserId, adminUserId));

      expect(entries.map((entry) => entry.action)).toContain("signed_in");
    });
  });

  describe("the authenticator app", () => {
    it("makes a password alone stop being a way in", async () => {
      const signIn = await auth.api.signInEmail({
        body: { email, password: TEST_PASSWORD },
        asResponse: true,
      });
      const cookie = signIn.headers.get("set-cookie") ?? "";

      const enabled = await auth.api.enableTwoFactor({
        body: { password: TEST_PASSWORD, method: "totp" },
        headers: new Headers({ cookie }),
      });

      if (!("totpURI" in enabled)) {
        throw new Error("Enabling two-factor did not return an authenticator enrolment.");
      }

      expect(enabled.totpURI).toContain("otpauth://totp/");
      expect(enabled.backupCodes.length).toBeGreaterThan(0);

      // Exactly what an authenticator app does with the QR code: take the
      // base32 secret out of the URI, decode it, and generate a code from it.
      const encodedSecret = new URL(
        enabled.totpURI.replace("otpauth://", "https://"),
      ).searchParams.get("secret");
      expect(encodedSecret).toBeTruthy();

      const secret = new TextDecoder().decode(base32.decode(encodedSecret!));
      const code = await createOTP(secret, { digits: TOTP_DIGITS }).totp();
      await auth.api.verifyTOTP({ body: { code }, headers: new Headers({ cookie }) });

      // The flag requireAdmin() reads is now set, so the Admin stops being
      // redirected to enrolment and is let into the app.
      const [admin] = await connection.db
        .select({ twoFactorEnabled: adminUsers.twoFactorEnabled })
        .from(adminUsers)
        .where(eq(adminUsers.id, adminUserId));

      expect(admin?.twoFactorEnabled).toBe(true);

      const secondSignIn = await auth.api.signInEmail({
        body: { email, password: TEST_PASSWORD },
      });

      expect(secondSignIn).toHaveProperty("twoFactorRedirect", true);
    });
  });
});
