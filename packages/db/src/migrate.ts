import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { Client } from "pg";
import { z } from "zod";

import {
  findMigrationProblems,
  type AppliedMigration,
  type RepoMigration,
} from "./migration-check";

export const MIGRATIONS_FOLDER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

/**
 * The lock every update run holds, so two runs (two deploys at once) never
 * overlap. Any fixed number works; this one is only ever used here.
 */
const MIGRATION_LOCK_KEY = 7_204_611_501;

/** Drizzle's own record of what has run. */
const APPLIED_QUERY = `select hash, created_at from drizzle.__drizzle_migrations order by created_at`;

export class MigrationProblemError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`The database updates don't match the repo:\n- ${problems.join("\n- ")}`);
    this.name = "MigrationProblemError";
  }
}

const journalSchema = z.object({
  entries: z.array(z.object({ tag: z.string(), when: z.number() })),
});

/** The repo's updates, named as in the journal (Drizzle reads them in the same order). */
function readRepoMigrations(migrationsFolder: string): RepoMigration[] {
  const journal = journalSchema.parse(
    JSON.parse(readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8")),
  );
  return readMigrationFiles({ migrationsFolder }).map((migration, index) => ({
    tag: journal.entries[index]?.tag ?? `entry ${index}`,
    folderMillis: migration.folderMillis,
    hash: migration.hash,
  }));
}

async function readApplied(client: Client): Promise<AppliedMigration[]> {
  const exists = await client.query(`select to_regclass('drizzle.__drizzle_migrations') as name`);
  if (!exists.rows[0]?.name) {
    return [];
  }
  const result = await client.query<{ hash: string; created_at: string }>(APPLIED_QUERY);
  return result.rows.map((row) => ({ hash: row.hash, createdAt: Number(row.created_at) }));
}

/**
 * Runs the waiting database updates (review G1-1): under a lock, only after
 * checking the repo and the database still agree, so nothing is ever
 * skipped without anyone knowing. Drizzle runs the waiting ones in one
 * transaction: all or nothing. Gives how many ran.
 */
export async function runMigrations(
  connectionString: string,
  migrationsFolder: string = MIGRATIONS_FOLDER,
): Promise<number> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    const repo = readRepoMigrations(migrationsFolder);
    const before = await readApplied(client);
    const problems = findMigrationProblems(repo, before);
    if (problems.length > 0) {
      throw new MigrationProblemError(problems);
    }
    await migrate(drizzle(client), { migrationsFolder });
    return (await readApplied(client)).length - before.length;
  } finally {
    // Ending the session releases the lock too.
    await client.end();
  }
}
