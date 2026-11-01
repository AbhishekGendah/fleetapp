import { describeErrorForLog } from "@fleetapp/core";
import { neonConfig, Pool } from "@neondatabase/serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/neon-serverless";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { Pool as NodePostgresPool } from "pg";
import ws from "ws";

import { getDbEnv } from "./env";
import * as schema from "./schema";

// The Neon serverless driver needs a WebSocket implementation in Node.js.
// It supports interactive transactions (BEGIN/COMMIT), which the app needs
// to set per-request tenant context with `SET LOCAL`.
neonConfig.webSocketConstructor = ws;

/**
 * Any Drizzle client over this schema, whichever driver is underneath.
 *
 * The apps use Neon's driver; the tests use node-postgres, because Neon's
 * speaks a WebSocket protocol only Neon serves. Code that takes this type can
 * be run by both, so a test exercises the same code the app does.
 */
export type AnyDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

/** A transaction on any of them, as `database.transaction()` hands it over. */
export type AnyTransaction = Parameters<Parameters<AnyDatabase["transaction"]>[0]>[0];

/** Idle connections are let go after this, before Neon's own timeout closes them under us. */
const IDLE_CONNECTION_MS = 10_000;

declare global {
  // `var` is required here: ambient global declarations don't support `let`/`const`.
  var __fleetappDbPools: Map<string, Pool | NodePostgresPool> | undefined;
}

/**
 * A database on this machine: the throwaway one the browser tests run the
 * app against. It speaks plain Postgres, not Neon's WebSocket protocol, so it
 * gets the standard driver. Real databases are always Neon.
 */
const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1"]);

function isLocalDatabase(connectionString: string): boolean {
  return LOCAL_DATABASE_HOSTS.has(new URL(connectionString).hostname);
}

/**
 * One pool per connection string, reused across requests.
 *
 * There is more than one connection string now: each app has its own database
 * role, and the login system has a third that can reach the credential tables
 * the rest of the app cannot. Keying by connection string keeps those pools
 * separate, which is the whole point of the separate roles.
 */
function getPool(connectionString: string): Pool | NodePostgresPool {
  const pools = (globalThis.__fleetappDbPools ??= new Map<string, Pool | NodePostgresPool>());

  const existing = pools.get(connectionString);
  if (existing) {
    return existing;
  }

  const settings = { connectionString, idleTimeoutMillis: IDLE_CONNECTION_MS };
  const pool = isLocalDatabase(connectionString)
    ? new NodePostgresPool(settings)
    : new Pool(settings);
  // Neon closes idle connections when its database sleeps; the pool reports
  // that as an "error" event, which with no listener would crash the server.
  // A dropped idle connection is simply replaced on the next query.
  pool.on("error", (error: unknown) => {
    console.warn("An idle database connection was closed", describeErrorForLog(error));
  });
  pools.set(connectionString, pool);
  return pool;
}

export function createDb(connectionString: string): AnyDatabase {
  if (!connectionString) {
    throw new Error("A connection string is required to create a database client.");
  }
  const pool = getPool(connectionString);
  return pool instanceof NodePostgresPool
    ? drizzleNodePostgres(pool, { schema })
    : drizzle(pool, { schema });
}

/** The app's own database client, using the role that app runs as. */
export function getDb(): AnyDatabase {
  return createDb(getDbEnv().DATABASE_URL);
}
