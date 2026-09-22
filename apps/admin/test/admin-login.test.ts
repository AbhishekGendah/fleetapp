import { randomUUID } from "node:crypto";

import { adminAccounts, adminActivityLog, adminUsers } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { createAdminAuth, type AdminAuth } from "../src/lib/auth-options";

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
 */
describe("admin login", () => {
  let connection: TestConnection;
  let auth: AdminAuth;
  let email: string;

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

    // Mirrors what the first-admin command does.
    email = `${randomUUID()}@example.test`;
    const { password } = await auth.$context;
    const hashedPassword = await password.hash(TEST_PASSWORD);

    const [admin] = await connection.db
      .insert(adminUsers)
      .values({ email, fullName: "A Test Admin", emailVerified: true })
      .returning({ id: adminUsers.id });

    await connection.db.insert(adminAccounts).values({
      adminUserId: admin!.id,
      accountId: admin!.id,
      providerId: "credential",
      password: hashedPassword,
      updatedAt: new Date(),
    });
  });

  afterAll(async () => {
    await connection.close();
  });

  it("signs in with the right password", async () => {
    const result = await auth.api.signInEmail({
      body: { email, password: TEST_PASSWORD },
    });

    expect(result.user.email).toBe(email);
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

  it("writes a line to the Admin activity log on sign-in", async () => {
    const [admin] = await connection.db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(eq(adminUsers.email, email));

    const entries = await connection.db
      .select({ action: adminActivityLog.action })
      .from(adminActivityLog)
      .where(eq(adminActivityLog.adminUserId, admin!.id));

    expect(entries.map((entry) => entry.action)).toContain("signed_in");
  });

  it("demands an authenticator code once one is set up", async () => {
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

    // From here on, a password alone is no longer a way in.
    const secondSignIn = await auth.api.signInEmail({
      body: { email, password: TEST_PASSWORD },
    });

    expect(secondSignIn).toHaveProperty("twoFactorRedirect", true);
  });
});
