import { neonConfig, Pool } from "@neondatabase/serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import ws from "ws";

import { dbEnv } from "./env";
import * as schema from "./schema";

// The Neon serverless driver needs a WebSocket implementation in Node.js.
// It supports interactive transactions (BEGIN/COMMIT), which the app needs
// to set per-request tenant context with `SET LOCAL`.
neonConfig.webSocketConstructor = ws;

export type Database = NeonDatabase<typeof schema>;

/**
 * Any Drizzle client over this schema, whichever driver is underneath.
 *
 * The apps use Neon's driver; the tests use node-postgres, because Neon's
 * speaks a WebSocket protocol only Neon serves. Code that takes this type can
 * be run by both, so a test exercises the same code the app does.
 */
export type AnyDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

declare global {
  // `var` is required here: ambient global declarations don't support `let`/`const`.
  var __fleetappDbPools: Map<string, Pool> | undefined;
}

/**
 * One pool per connection string, reused across requests.
 *
 * There is more than one connection string now: each app has its own database
 * role, and the login system has a third that can reach the credential tables
 * the rest of the app cannot. Keying by connection string keeps those pools
 * separate, which is the whole point of the separate roles.
 */
function getPool(connectionString: string): Pool {
  const pools = (globalThis.__fleetappDbPools ??= new Map<string, Pool>());

  const existing = pools.get(connectionString);
  if (existing) {
    return existing;
  }

  const pool = new Pool({ connectionString });
  pools.set(connectionString, pool);
  return pool;
}

export function createDb(connectionString: string): Database {
  if (!connectionString) {
    throw new Error("A connection string is required to create a database client.");
  }
  return drizzle(getPool(connectionString), { schema });
}

/** The app's own database client, using the role that app runs as. */
export function getDb(): Database {
  return createDb(dbEnv.DATABASE_URL);
}
