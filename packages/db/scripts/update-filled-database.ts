import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { z } from "zod";

import { describeMigrationFailure, MigrationProblemError, runMigrations } from "../src/migrate";

/**
 * CI's "update a filled database" check (review G1-2), last step: runs this
 * change's database updates on a database that `main`'s own test run has
 * already built and filled with the demo data. Run as the same owner login
 * the tests use, as on Neon. Fails if any update fails.
 */
const TEST_DATABASE = "fleetapp_test";
const OWNER_ROLE = "fleetapp_test_owner";

const envSchema = z.object({
  TEST_POSTGRES_SUPERUSER_URL: z
    .string({ error: "TEST_POSTGRES_SUPERUSER_URL is not set: the throwaway server's superuser." })
    .regex(/^postgres(ql)?:\/\//, "TEST_POSTGRES_SUPERUSER_URL must be a postgres:// address."),
});

/** The owner login's address, with a fresh password, since `main`'s run chose its own. */
async function ownerUrl(superuserUrl: string): Promise<string> {
  const password = randomUUID();
  const client = new Client({ connectionString: superuserUrl });
  await client.connect();
  try {
    await client.query(`ALTER ROLE ${OWNER_ROLE} PASSWORD '${password}'`);
  } finally {
    await client.end();
  }
  const url = new URL(superuserUrl);
  url.username = OWNER_ROLE;
  url.password = password;
  url.pathname = `/${TEST_DATABASE}`;
  return url.toString();
}

async function countRows(url: string): Promise<number> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query<{ total: string }>(`select count(*) as total from renters`);
    return Number(result.rows[0]?.total ?? 0);
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const env = envSchema.parse(process.env);
  const superuserUrl = new URL(env.TEST_POSTGRES_SUPERUSER_URL);
  superuserUrl.pathname = `/${TEST_DATABASE}`;
  // Read as the superuser: row-level security would hide every business's rows from the owner.
  const renters = await countRows(superuserUrl.toString());
  if (renters === 0) {
    throw new Error("The database was not filled: main's demo-data run added no Renters.");
  }
  const count = await runMigrations(await ownerUrl(env.TEST_POSTGRES_SUPERUSER_URL));
  console.log(`Ran ${count} new database update(s) on a database holding ${renters} Renters.`);
}

try {
  await main();
} catch (error) {
  console.error(
    error instanceof MigrationProblemError ? error.message : "Updating the filled database failed",
    error instanceof MigrationProblemError ? "" : describeMigrationFailure(error),
  );
  process.exit(1);
}
