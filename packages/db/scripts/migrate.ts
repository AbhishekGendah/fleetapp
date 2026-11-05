import "dotenv/config";

import { describeErrorForLog } from "@fleetapp/core";
import { z } from "zod";

import { MigrationProblemError, runMigrations } from "../src/migrate";

/**
 * `pnpm db:migrate`: runs the waiting database updates. The address is the
 * owner login's direct (unpooled) one, from the environment only (rule 6).
 */
const envSchema = z.object({
  DATABASE_MIGRATION_URL: z
    .string({ error: "DATABASE_MIGRATION_URL is not set: the owner login's direct address." })
    .regex(/^postgres(ql)?:\/\//, "DATABASE_MIGRATION_URL must be a postgres:// address."),
});

async function main(): Promise<void> {
  const env = envSchema.safeParse(process.env);
  if (!env.success) {
    console.error(env.error.issues.map((issue) => issue.message).join("\n"));
    process.exit(1);
  }
  try {
    const count = await runMigrations(env.data.DATABASE_MIGRATION_URL);
    console.log(count === 0 ? "No database updates waiting." : `Ran ${count} database update(s).`);
  } catch (error) {
    if (error instanceof MigrationProblemError) {
      console.error(error.message);
    } else {
      // Postgres's own words are needed to fix a failed update. The updates
      // hold no personal data, and the address never appears in them.
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
      console.error("A database update failed", {
        ...describeErrorForLog(cause),
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
    process.exit(1);
  }
}

await main();
