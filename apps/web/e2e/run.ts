/**
 * Runs the Operator app's browser tests end to end: a throwaway Postgres with
 * the real migrations, a local S3 (LocalStack) for uploads, a stand-in for
 * Google Places, one made-up business with an invited User, the app built and
 * started against them, then Playwright. Everything is torn down afterwards.
 *
 * Usage: pnpm --filter web e2e
 * Only made-up data, in stores that exist for this run only.
 */
import { describeErrorForLog, getInviteExpiry } from "@fleetapp/core";
import { generateSecretToken, hashSecretToken } from "@fleetapp/core/server";
import { createDb } from "@fleetapp/db/client";
import { adminUsers, operatorInvites, operators, users } from "@fleetapp/db/schema";
import {
  ADMIN_APP_ROLE,
  APPLICATION_ROLES,
  WEB_APP_ROLE,
  WEB_AUTH_ROLE,
} from "@fleetapp/db/tenancy";
import { migrateTestDatabase, startTestPostgres } from "@fleetapp/db/testing";
import { startFakePlaces } from "@fleetapp/e2e/fake-places";
import { startLocalS3 } from "@fleetapp/e2e/local-s3";
import { runToEnd, startNextApp } from "@fleetapp/e2e/processes";

import {
  E2E_BASE_URL,
  E2E_BUCKETS,
  E2E_CRON_SECRET,
  E2E_PORT,
  E2E_STRIPE_WEBHOOK_SECRET,
  E2E_USER,
} from "./e2e-settings";

const EXIT_FAILURE = 1;
const TEST_SECRET = "an-e2e-only-signing-secret-of-32-chars-or-more";

/** One made-up business with one invited User; returns the invite's secret for the address. */
async function seedInvitedUser(adminDatabaseUrl: string): Promise<string> {
  const database = createDb(adminDatabaseUrl);
  const [admin] = await database
    .insert(adminUsers)
    .values({ email: "e2e-inviting-admin@example.test", fullName: "E2E Admin" })
    .returning({ id: adminUsers.id });
  const [operator] = await database
    .insert(operators)
    .values({ legalName: "E2E Rentals Pty Ltd" })
    .returning({ id: operators.id });
  const [user] = await database
    .insert(users)
    .values({ operatorId: operator!.id, email: E2E_USER.email, fullName: E2E_USER.fullName })
    .returning({ id: users.id });
  const token = generateSecretToken();
  await database.insert(operatorInvites).values({
    operatorId: operator!.id,
    userId: user!.id,
    tokenHash: hashSecretToken(token),
    expiresAt: getInviteExpiry(new Date()),
    sentAt: new Date(),
    createdByAdminId: admin!.id,
  });
  return token;
}

async function main(): Promise<void> {
  const postgres = await startTestPostgres(APPLICATION_ROLES);
  const places = await startFakePlaces();
  const stops: Array<() => unknown> = [() => postgres.stop(), () => places.stop()];
  try {
    await migrateTestDatabase(postgres.ownerUrl);
    const inviteToken = await seedInvitedUser(postgres.urlForRole(ADMIN_APP_ROLE));
    const s3 = await startLocalS3({
      buckets: Object.values(E2E_BUCKETS),
      allowedOrigin: E2E_BASE_URL,
    });
    stops.push(() => s3.stop());

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      APP_URL: E2E_BASE_URL,
      DATABASE_URL: postgres.urlForRole(WEB_APP_ROLE),
      AUTH_DATABASE_URL: postgres.urlForRole(WEB_AUTH_ROLE),
      BETTER_AUTH_SECRET: TEST_SECRET,
      AUTH_ISSUER_NAME: "E2E",
      EMAIL_TRANSPORT: "dev_outbox",
      EMAIL_FROM: "E2E <no-reply@example.test>",
      GOOGLE_PLACES_API_KEY: "e2e-key",
      GOOGLE_PLACES_API_URL: places.url,
      STORAGE_BUCKET: E2E_BUCKETS.general,
      IDENTITY_STORAGE_BUCKET: E2E_BUCKETS.identity,
      FILE_STORAGE_REGION: s3.region,
      FILE_STORAGE_ACCESS_KEY_ID: s3.accessKeyId,
      FILE_STORAGE_SECRET_ACCESS_KEY: s3.secretAccessKey,
      FILE_STORAGE_ENDPOINT: s3.endpoint,
      CRON_SECRET: E2E_CRON_SECRET,
      OPS_ALERT_EMAIL: "ops@example.test",
      // Stripe's stand-in (decision 6): the browser tests never talk to Stripe.
      PAYMENTS_TRANSPORT: "stand_in",
      APP_STAGE: "development",
      STRIPE_WEBHOOK_SECRET: E2E_STRIPE_WEBHOOK_SECRET,
      NEXT_TELEMETRY_DISABLED: "1",
    };
    const app = await startNextApp({ port: E2E_PORT, env });
    stops.push(() => app.stop());
    await runToEnd("pnpm", ["exec", "playwright", "test", ...process.argv.slice(2)], {
      env: {
        ...env,
        E2E_INVITE_TOKEN: inviteToken,
        // The tests read the test inbox, as a person reads their email.
        E2E_SUPERUSER_URL: postgres.superuserUrl,
      },
    });
  } finally {
    for (const stop of stops.reverse()) {
      await stop();
    }
  }
}

main().catch((error: unknown) => {
  console.error("The browser tests failed", describeErrorForLog(error));
  process.exit(EXIT_FAILURE);
});
