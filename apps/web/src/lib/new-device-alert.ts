import {
  describeDevice,
  formatDateTimeInTimeZone,
  generateSecretToken,
  hashSecretToken,
} from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import { operators, userKnownDevices, users } from "@fleetapp/db/schema";
import { renderNewDeviceSignInEmail, type EmailSender } from "@fleetapp/email";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { and, eq, sql } from "drizzle-orm";

import { absoluteUrl, FORGOT_PASSWORD_PATH } from "./paths";

const KNOWN_DEVICE_COOKIE = "known_device";

/** Browsers cap a cookie's life at 400 days; asking for more gets less. */
const KNOWN_DEVICE_COOKIE_SECONDS = 400 * 24 * 60 * 60;

export interface NewDeviceAlertOptions {
  database: AnyDatabase;
  emailSender: EmailSender;
  appUrl: string;
  now?: () => Date;
}

interface DeviceCheck {
  userId: string;
  deviceToken: string;
  userAgent: string | null;
  signedInAt: Date;
}

/**
 * Records the device and says whether to alert: only for a device this User
 * has not used before, and never for their very first one. That first one
 * is the browser that accepted the invite, which is them by definition.
 */
async function recordDevice(database: AnyDatabase, check: DeviceCheck): Promise<boolean> {
  const deviceHash = hashSecretToken(check.deviceToken);

  const updated = await database
    .update(userKnownDevices)
    .set({ lastSeenAt: check.signedInAt })
    .where(
      and(eq(userKnownDevices.userId, check.userId), eq(userKnownDevices.deviceHash, deviceHash)),
    )
    .returning({ id: userKnownDevices.id });
  if (updated.length > 0) {
    return false;
  }

  const [{ knownCount } = { knownCount: 0 }] = await database
    .select({ knownCount: sql<number>`count(*)::int` })
    .from(userKnownDevices)
    .where(eq(userKnownDevices.userId, check.userId));

  await database
    .insert(userKnownDevices)
    .values({
      userId: check.userId,
      deviceHash,
      firstSeenAt: check.signedInAt,
      lastSeenAt: check.signedInAt,
    })
    .onConflictDoNothing();

  return knownCount > 0;
}

async function sendAlert(options: NewDeviceAlertOptions, check: DeviceCheck): Promise<void> {
  const [recipient] = await options.database
    .select({ email: users.email, name: users.fullName, timezone: operators.timezone })
    .from(users)
    .innerJoin(operators, eq(operators.id, users.operatorId))
    .where(eq(users.id, check.userId));
  if (!recipient) {
    return;
  }

  const message = await renderNewDeviceSignInEmail({
    to: recipient.email,
    name: recipient.name,
    signedInAt: formatDateTimeInTimeZone(check.signedInAt, recipient.timezone),
    deviceDescription: describeDevice(check.userAgent),
    resetPasswordUrl: absoluteUrl(options.appUrl, FORGOT_PASSWORD_PATH),
  });
  await options.emailSender.send(message);
}

/**
 * Emails a User when their login is used from a browser it has not been used
 * from before.
 *
 * Runs after anything that creates a session: a password-only sign-in on a
 * trusted device, the authenticator step, a recovery code, accepting an
 * invite. Each browser gets a long-lived random cookie marking it; only that
 * cookie's fingerprint is stored. A failure here is logged and never stops
 * the sign-in it is about.
 */
export function newDeviceAlert(options: NewDeviceAlertOptions): BetterAuthPlugin {
  const now = options.now ?? (() => new Date());

  return {
    id: "new-device-alert",
    hooks: {
      after: [
        {
          matcher: () => true,
          handler: createAuthMiddleware(async (ctx) => {
            const newSession = ctx.context.newSession;
            if (!newSession) {
              return;
            }
            const cookie = ctx.context.createAuthCookie(KNOWN_DEVICE_COOKIE, {
              maxAge: KNOWN_DEVICE_COOKIE_SECONDS,
            });
            const deviceToken = ctx.getCookie(cookie.name) ?? generateSecretToken();
            // Set every time, so a browser in daily use never reaches the end.
            ctx.setCookie(cookie.name, deviceToken, cookie.attributes);

            const check: DeviceCheck = {
              userId: newSession.user.id,
              deviceToken,
              userAgent: ctx.headers?.get("user-agent") ?? null,
              signedInAt: now(),
            };
            try {
              if (await recordDevice(options.database, check)) {
                await sendAlert(options, check);
              }
            } catch (error) {
              console.error("The new-device check failed", {
                errorType: error instanceof Error ? error.name : typeof error,
              });
            }
          }),
        },
      ],
    },
  };
}
