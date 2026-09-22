import path from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

import * as schema from "../schema";

const MIGRATIONS_FOLDER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "migrations",
);

export type TestDatabase = NodePgDatabase<typeof schema>;

export interface TestConnection {
  db: TestDatabase;
  close(): Promise<void>;
}

export interface ConnectOptions {
  maxConnections?: number;
}

/**
 * Connects on the node-postgres driver rather than the Neon one the apps use.
 * Neon's driver speaks a WebSocket protocol only Neon serves, so it cannot
 * reach a local Postgres. The SQL, the schema and the roles under test are the
 * real ones either way.
 */
export function connectAs(
  connectionString: string,
  { maxConnections }: ConnectOptions = {},
): TestConnection {
  const pool = new Pool({ connectionString, max: maxConnections });
  return {
    db: drizzle(pool, { schema }),
    close: () => pool.end(),
  };
}

/** Applies the real migration files, as the owner role. */
export async function migrateTestDatabase(ownerUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: ownerUrl });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}
