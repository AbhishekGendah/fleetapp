import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { runMigrations } from "../migrate";
import * as schema from "../schema";

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
  // The same command the real databases are updated with (review G1-1).
  await runMigrations(ownerUrl);
}
