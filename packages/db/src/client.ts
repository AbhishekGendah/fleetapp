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

/** Either driver's pool class: Neon's for real databases, node-postgres's for local ones. */
type PoolClass = typeof Pool | typeof NodePostgresPool;
type AnyPool = Pool | NodePostgresPool;

declare global {
  // `var` is required here: ambient global declarations don't support `let`/`const`.
  var __fleetappDbPoolsByDriver: Map<PoolClass, Map<string, AnyPool>> | undefined;
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

function driverPoolFor(connectionString: string): PoolClass {
  return isLocalDatabase(connectionString) ? NodePostgresPool : Pool;
}

function newPool(connectionString: string): AnyPool {
  const DriverPool = driverPoolFor(connectionString);
  const pool = new DriverPool({ connectionString, idleTimeoutMillis: IDLE_CONNECTION_MS });
  // Neon closes idle connections when its database sleeps; the pool reports
  // that as an "error" event, which with no listener would crash the server.
  // A dropped idle connection is simply replaced on the next query.
  pool.on("error", (error: unknown) => {
    console.warn("An idle database connection was closed", describeErrorForLog(error));
  });
  return pool;
}

/**
 * One pool per driver and connection string, reused across requests.
 *
 * There is more than one connection string: each app has its own database
 * role, and the login system has a third that can reach the credential tables
 * the rest of the app cannot. Keying by connection string keeps those pools
 * separate, which is the whole point of the separate roles.
 *
 * Keyed by the driver's own pool class too, because one server can load more
 * than one copy of the driver: Next.js bundles its start-up hook apart from
 * the pages. Drizzle holds a transaction to one connection only when the pool
 * is an instance of the very class it imported; a pool made by another copy
 * fails that check, so each statement of a "transaction" ran on whichever
 * connection was free, and some ran with no business set (the dev site,
 * 5 to 11 Nov 2026). Each copy now only ever gets the pools it made itself.
 * The map stays on globalThis so a hot reload in development, which runs
 * this file again but not the driver, keeps its pools.
 */
function getPool(connectionString: string): AnyPool {
  const byDriver = (globalThis.__fleetappDbPoolsByDriver ??= new Map());
  const DriverPool = driverPoolFor(connectionString);
  let pools = byDriver.get(DriverPool);
  if (!pools) {
    pools = new Map<string, AnyPool>();
    byDriver.set(DriverPool, pools);
  }
  const existing = pools.get(connectionString);
  if (existing) {
    return existing;
  }
  const pool = newPool(connectionString);
  pools.set(connectionString, pool);
  return pool;
}

function requireConnectionString(connectionString: string): void {
  if (!connectionString) {
    throw new Error("A connection string is required to create a database client.");
  }
}

function drizzleOn(pool: AnyPool): AnyDatabase {
  return pool instanceof NodePostgresPool
    ? drizzleNodePostgres(pool, { schema })
    : drizzle(pool, { schema });
}

export function createDb(connectionString: string): AnyDatabase {
  requireConnectionString(connectionString);
  return drizzleOn(getPool(connectionString));
}

/** A connection of its own, never shared, for a one-off job such as the start-up checks. */
export interface ShortLivedDb {
  db: AnyDatabase;
  close: () => Promise<void>;
}

/**
 * A database client on a pool of its own, which the caller closes when done.
 * The start-up checks use it so they never make, or keep, the pool the app's
 * requests then run on.
 */
export function openShortLivedDb(connectionString: string): ShortLivedDb {
  requireConnectionString(connectionString);
  const pool = newPool(connectionString);
  return { db: drizzleOn(pool), close: () => pool.end() };
}

/** The app's own database client, using the role that app runs as. */
export function getDb(): AnyDatabase {
  return createDb(getDbEnv().DATABASE_URL);
}
