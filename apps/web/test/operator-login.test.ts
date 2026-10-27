import { randomUUID } from "node:crypto";

import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { generateSecretToken, getInviteExpiry, hashSecretToken } from "@fleetapp/core";
import {
  activityLog,
  adminUsers,
  operatorInvites,
  operators,
  userKnownDevices,
  users,
  userVerifications,
} from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import type { EmailMessage, EmailSender } from "@fleetapp/email";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { createUserAuth, type UserAuth } from "../src/lib/auth-options";
import { acceptInvite, InviteNotUsableError } from "../src/lib/invites/accept-invite";
import { findUsableInvite } from "../src/lib/invites/find-invite";

const TEST_PASSWORD = "a-long-enough-test-password";
const WRONG_PASSWORD = "not-the-right-password";
const TEST_SECRET = "a-test-signing-secret-at-least-32-chars-long";
const TEST_BASE_URL = "http://localhost:3000";
const TOTP_DIGITS = 6;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const TRUST_DEVICE_COOKIE = "trust_device";
const NEW_PASSWORD = "a-different-long-password";
const RESET_LINK_PATTERN = /\/reset-password\?token=([^\s"&]+)/;

/** Keeps what would have been sent, so a test can open the link in it. */
function createRecordingSender(): EmailSender & { messages: EmailMessage[] } {
  const messages: EmailMessage[] = [];
  return {
    messages,
    async send(message) {
      messages.push(message);
    },
  };
}

interface SeededInvite {
  token: string;
  email: string;
  operatorId: string;
  userId: string;
  inviteId: string;
}

/** The cookies a browser would send back, from a response's Set-Cookie headers. */
function cookiesFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/** Exactly what an authenticator app does with the QR code. */
async function codeFor(totpURI: string): Promise<string> {
  const encoded = new URL(totpURI.replace("otpauth://", "https://")).searchParams.get("secret");
  const secret = new TextDecoder().decode(base32.decode(encoded ?? ""));
  return createOTP(secret, { digits: TOTP_DIGITS }).totp();
}

/**
 * The Operator login, run as the real login role against a real Postgres with
 * the real migrations. Seeding goes through the admin role, as the admin app
 * does in real life.
 */
describe("the Operator login", () => {
  let admin: TestConnection;
  let webAuth: TestConnection;
  let auth: UserAuth;
  let adminUserId: string;
  let sender: ReturnType<typeof createRecordingSender>;

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    webAuth = connectAs(inject("webAuthRoleUrl"));
    sender = createRecordingSender();
    auth = createUserAuth({
      database: webAuth.db,
      baseURL: TEST_BASE_URL,
      secret: TEST_SECRET,
      issuerName: "Test Issuer",
      emailSender: sender,
    });

    const [adminUser] = await admin.db
      .insert(adminUsers)
      .values({ email: `${randomUUID()}@example.test`, fullName: "Inviting Admin" })
      .returning({ id: adminUsers.id });
    if (!adminUser) {
      throw new Error("Could not seed an Admin.");
    }
    adminUserId = adminUser.id;
  });

  afterAll(async () => {
    await Promise.all([admin.close(), webAuth.close()]);
  });

  async function seedInvite(
    overrides: { expiresAt?: Date; revokedAt?: Date } = {},
  ): Promise<SeededInvite> {
    const [operator] = await admin.db
      .insert(operators)
      .values({ legalName: `Test Rentals ${randomUUID()}` })
      .returning({ id: operators.id });
    const email = `${randomUUID()}@example.test`;
    const [user] = await admin.db
      .insert(users)
      .values({ operatorId: operator!.id, email, fullName: "Sam Example" })
      .returning({ id: users.id });
    const token = generateSecretToken();
    const [invite] = await admin.db
      .insert(operatorInvites)
      .values({
        operatorId: operator!.id,
        userId: user!.id,
        tokenHash: hashSecretToken(token),
        expiresAt: overrides.expiresAt ?? getInviteExpiry(new Date()),
        revokedAt: overrides.revokedAt,
        sentAt: new Date(),
        createdByAdminId: adminUserId,
      })
      .returning({ id: operatorInvites.id });

    return { token, email, operatorId: operator!.id, userId: user!.id, inviteId: invite!.id };
  }

  async function seedAcceptedUser(): Promise<SeededInvite> {
    const seeded = await seedInvite();
    await acceptInvite({
      database: webAuth.db,
      auth,
      token: seeded.token,
      password: TEST_PASSWORD,
      now: new Date(),
    });
    return seeded;
  }

  async function historyOf(operatorId: string): Promise<string[]> {
    const rows = await admin.db
      .select({ entityType: activityLog.entityType, action: activityLog.action })
      .from(activityLog)
      .where(eq(activityLog.operatorId, operatorId));
    return rows.map((row) => `${row.entityType} ${row.action}`);
  }

  describe("accepting an invite", () => {
    it("sets a password, marks the invite used and lets the User sign in", async () => {
      const seeded = await seedAcceptedUser();

      const [invite] = await admin.db
        .select({ acceptedAt: operatorInvites.acceptedAt })
        .from(operatorInvites)
        .where(eq(operatorInvites.id, seeded.inviteId));
      expect(invite?.acceptedAt).not.toBeNull();

      const signIn = await auth.api.signInEmail({
        body: { email: seeded.email, password: TEST_PASSWORD },
      });
      expect(signIn.user.email).toBe(seeded.email);
      expect(await historyOf(seeded.operatorId)).toContain("operator_invite accepted");
    });

    it("cannot be used twice", async () => {
      const seeded = await seedAcceptedUser();

      expect(await findUsableInvite(webAuth.db, seeded.token, new Date())).toBeNull();
      await expect(
        acceptInvite({
          database: webAuth.db,
          auth,
          token: seeded.token,
          password: TEST_PASSWORD,
          now: new Date(),
        }),
      ).rejects.toBeInstanceOf(InviteNotUsableError);
    });

    it("lets exactly one of two acceptances at once succeed", async () => {
      const seeded = await seedInvite();
      const accept = () =>
        acceptInvite({
          database: webAuth.db,
          auth,
          token: seeded.token,
          password: TEST_PASSWORD,
          now: new Date(),
        });

      const results = await Promise.allSettled([accept(), accept()]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    });

    it("refuses an expired, cancelled or unknown link, or a suspended Operator", async () => {
      const expired = await seedInvite({ expiresAt: new Date(Date.now() - ONE_DAY_MS) });
      const revoked = await seedInvite({ revokedAt: new Date() });
      const suspended = await seedInvite();
      await admin.db
        .update(operators)
        .set({ suspendedAt: new Date() })
        .where(eq(operators.id, suspended.operatorId));

      for (const token of [expired.token, revoked.token, suspended.token, generateSecretToken()]) {
        expect(await findUsableInvite(webAuth.db, token, new Date())).toBeNull();
      }
    });
  });

  describe("signing in", () => {
    it("puts the User's own Operator on the session", async () => {
      const seeded = await seedAcceptedUser();
      const response = await auth.api.signInEmail({
        body: { email: seeded.email, password: TEST_PASSWORD },
        asResponse: true,
      });

      const session = await auth.api.getSession({
        headers: new Headers({ cookie: cookiesFrom(response) }),
      });

      expect(session?.user.operatorId).toBe(seeded.operatorId);
    });

    it("refuses a suspended Operator's User, even with the right password", async () => {
      const seeded = await seedAcceptedUser();
      await admin.db
        .update(operators)
        .set({ suspendedAt: new Date() })
        .where(eq(operators.id, seeded.operatorId));

      await expect(
        auth.api.signInEmail({ body: { email: seeded.email, password: TEST_PASSWORD } }),
      ).rejects.toThrow();
    });

    it("locks the login after five wrong passwords", async () => {
      const seeded = await seedAcceptedUser();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(
          auth.api.signInEmail({ body: { email: seeded.email, password: WRONG_PASSWORD } }),
        ).rejects.toThrow();
      }

      await expect(
        auth.api.signInEmail({ body: { email: seeded.email, password: TEST_PASSWORD } }),
      ).rejects.toThrow();
      expect(await historyOf(seeded.operatorId)).toContain("user locked_out");
    });
  });

  /**
   * Enrols an authenticator, then signs in with "remember this device", as a
   * User would. Returns the trust cookie that browser now holds.
   */
  async function enrolAndTrustDevice(email: string): Promise<string> {
    const firstSignIn = await auth.api.signInEmail({
      body: { email, password: TEST_PASSWORD },
      asResponse: true,
    });
    const sessionCookie = cookiesFrom(firstSignIn);

    const enrolment = await auth.api.enableTwoFactor({
      body: { password: TEST_PASSWORD },
      headers: new Headers({ cookie: sessionCookie }),
    });
    if (!("totpURI" in enrolment)) {
      throw new Error("Enabling two-factor did not return an authenticator enrolment.");
    }
    await auth.api.verifyTOTP({
      body: { code: await codeFor(enrolment.totpURI) },
      headers: new Headers({ cookie: sessionCookie }),
    });

    // A password alone no longer signs in...
    const passwordStep = await auth.api.signInEmail({
      body: { email, password: TEST_PASSWORD },
      asResponse: true,
    });
    expect(await passwordStep.clone().json()).toHaveProperty("twoFactorRedirect", true);

    // ...but the code, with "remember this device", hands back a trust cookie.
    const codeStep = await auth.api.verifyTOTP({
      body: { code: await codeFor(enrolment.totpURI), trustDevice: true },
      headers: new Headers({ cookie: cookiesFrom(passwordStep) }),
      asResponse: true,
    });
    const trustCookie = codeStep.headers
      .getSetCookie()
      .find((cookie) => cookie.includes(TRUST_DEVICE_COOKIE));
    if (!trustCookie) {
      throw new Error("The code step did not remember the device.");
    }
    return trustCookie.split(";")[0]!;
  }

  const signInOnDevice = (email: string, password: string, trustCookie: string) =>
    auth.api.signInEmail({
      body: { email, password },
      headers: new Headers({ cookie: trustCookie }),
    });

  describe("the authenticator app", () => {
    it("is required after enrolment, and a remembered device skips it", async () => {
      const seeded = await seedAcceptedUser();

      const trustCookie = await enrolAndTrustDevice(seeded.email);

      expect(await historyOf(seeded.operatorId)).toContain("user two_factor_enrolled");
      expect(await signInOnDevice(seeded.email, TEST_PASSWORD, trustCookie)).not.toHaveProperty(
        "twoFactorRedirect",
      );
    });
  });

  describe("resetting a password", () => {
    function emailsTo(email: string): EmailMessage[] {
      return sender.messages.filter((message) => message.to === email);
    }

    async function requestReset(email: string): Promise<string | null> {
      await auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } });
      const token = emailsTo(email).at(-1)?.text.match(RESET_LINK_PATTERN)?.[1];
      return token ? decodeURIComponent(token) : null;
    }

    const signInWith = (email: string, password: string) =>
      auth.api.signInEmail({ body: { email, password } });

    it("emails a link that sets a new password once, keeping only its fingerprint", async () => {
      const seeded = await seedAcceptedUser();
      const token = await requestReset(seeded.email);
      expect(token).toBeTruthy();

      const stored = await webAuth.db.select().from(userVerifications);
      expect(JSON.stringify(stored)).not.toContain(token!);

      await auth.api.resetPassword({ body: { newPassword: NEW_PASSWORD, token: token! } });

      await expect(signInWith(seeded.email, TEST_PASSWORD)).rejects.toThrow();
      await expect(signInWith(seeded.email, NEW_PASSWORD)).resolves.toBeDefined();
      await expect(
        auth.api.resetPassword({ body: { newPassword: TEST_PASSWORD, token: token! } }),
      ).rejects.toThrow();
      expect(await historyOf(seeded.operatorId)).toContain("user password_reset");
    });

    it("signs out every existing session", async () => {
      const seeded = await seedAcceptedUser();
      const signIn = await auth.api.signInEmail({
        body: { email: seeded.email, password: TEST_PASSWORD },
        asResponse: true,
      });
      const cookie = cookiesFrom(signIn);

      const token = await requestReset(seeded.email);
      await auth.api.resetPassword({ body: { newPassword: NEW_PASSWORD, token: token! } });

      expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    });

    it("forgets every remembered device, so the next sign-in needs the code", async () => {
      const seeded = await seedAcceptedUser();
      const trustCookie = await enrolAndTrustDevice(seeded.email);

      const token = await requestReset(seeded.email);
      await auth.api.resetPassword({ body: { newPassword: NEW_PASSWORD, token: token! } });

      expect(await signInOnDevice(seeded.email, NEW_PASSWORD, trustCookie)).toHaveProperty(
        "twoFactorRedirect",
        true,
      );
    });

    it("lifts a wrong-password lockout", async () => {
      const seeded = await seedAcceptedUser();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(signInWith(seeded.email, WRONG_PASSWORD)).rejects.toThrow();
      }

      const token = await requestReset(seeded.email);
      await auth.api.resetPassword({ body: { newPassword: NEW_PASSWORD, token: token! } });

      await expect(signInWith(seeded.email, NEW_PASSWORD)).resolves.toBeDefined();
    });

    it("sends nothing for an unknown email or a suspended Operator, and says the same", async () => {
      const seeded = await seedAcceptedUser();
      await admin.db
        .update(operators)
        .set({ suspendedAt: new Date() })
        .where(eq(operators.id, seeded.operatorId));
      const unknownEmail = `${randomUUID()}@example.test`;

      const forSuspended = await auth.api.requestPasswordReset({
        body: { email: seeded.email, redirectTo: "/reset-password" },
      });
      const forUnknown = await auth.api.requestPasswordReset({
        body: { email: unknownEmail, redirectTo: "/reset-password" },
      });

      expect(forSuspended).toEqual(forUnknown);
      expect(emailsTo(seeded.email)).toEqual([]);
      expect(emailsTo(unknownEmail)).toEqual([]);
    });
  });

  describe("emailing about a new device", () => {
    const CHROME_ON_WINDOWS =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    const KNOWN_DEVICE_COOKIE = "known_device";

    const newDeviceEmailsTo = (email: string) =>
      sender.messages.filter(
        (message) => message.to === email && message.subject.includes("New sign-in"),
      );

    async function signInFrom(email: string, cookie?: string): Promise<string> {
      const response = await auth.api.signInEmail({
        body: { email, password: TEST_PASSWORD },
        headers: new Headers({ "user-agent": CHROME_ON_WINDOWS, ...(cookie ? { cookie } : {}) }),
        asResponse: true,
      });
      const deviceCookie = response.headers
        .getSetCookie()
        .find((setCookie) => setCookie.includes(KNOWN_DEVICE_COOKIE));
      if (!deviceCookie) {
        throw new Error("The sign-in did not mark the browser.");
      }
      return deviceCookie.split(";")[0]!;
    }

    it("stays quiet for the first browser and for a browser it already knows", async () => {
      const seeded = await seedAcceptedUser();

      const deviceCookie = await signInFrom(seeded.email);
      await signInFrom(seeded.email, deviceCookie);

      expect(newDeviceEmailsTo(seeded.email)).toEqual([]);
    });

    it("emails the User, naming the device, when a new browser signs in", async () => {
      const seeded = await seedAcceptedUser();
      await signInFrom(seeded.email);

      await signInFrom(seeded.email);

      const [alert] = newDeviceEmailsTo(seeded.email);
      expect(alert?.text).toContain("Chrome on Windows");
      expect(alert?.text).toContain("/forgot-password");
    });

    it("keeps only a fingerprint of the cookie that marks the browser", async () => {
      const seeded = await seedAcceptedUser();
      const deviceCookie = await signInFrom(seeded.email);
      const token = decodeURIComponent(deviceCookie.split("=")[1]!);

      const [device] = await webAuth.db
        .select()
        .from(userKnownDevices)
        .where(eq(userKnownDevices.userId, seeded.userId));

      expect(device?.deviceHash).toBe(hashSecretToken(token));
      expect(device?.operatorId).toBe(seeded.operatorId);
    });
  });
});
