import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { Client } from "pg";

const run = promisify(execFile);

/**
 * Pinned so CI runs against the same major version as Neon rather than
 * whatever `latest` happens to be today.
 */
const POSTGRES_IMAGE = "postgres:17-alpine";

/**
 * Set this to a superuser connection string to test against a Postgres that is
 * already running, instead of starting a container. Useful where image pulls
 * are blocked, and for anyone who would rather keep a server running locally.
 */
const EXISTING_SERVER_ENV_VAR = "TEST_POSTGRES_SUPERUSER_URL";

const READINESS_ATTEMPTS = 60;
const READINESS_INTERVAL_MS = 500;

const DEFAULT_POSTGRES_PORT = "5432";
const OWNER_ROLE = "fleetapp_test_owner";

/**
 * Arbitrary but fixed: any two runs sharing a server must pick the same number
 * for the lock to mean anything.
 */
const PROVISIONING_LOCK_KEY = 8_314_707;
const TEST_DATABASE = "fleetapp_test";

export interface TestPostgres {
  /**
   * Superuser connection. Used by one test only, to prove the append-only
   * trigger fires for a connection that grants and row-level security do not
   * stop — the exact situation the trigger exists to cover.
   */
  superuserUrl: string;
  /**
   * Owner-role connection string, used to run the migrations. Deliberately not
   * a superuser: a superuser bypasses row-level security outright, which would
   * make the tenancy tests prove nothing.
   */
  ownerUrl: string;
  urlForRole(role: string): string;
  stop(): Promise<void>;
}

function connectionUrl(role: string, password: string, hostAndPort: string): string {
  return `postgres://${role}:${password}@${hostAndPort}/${TEST_DATABASE}`;
}

/** The superuser connects to `postgres` to create the test database, then has
 *  to be pointed at the test database itself. */
function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

async function waitUntilAccepting(superuserUrl: string): Promise<void> {
  for (let attempt = 0; attempt < READINESS_ATTEMPTS; attempt += 1) {
    const client = new Client({ connectionString: superuserUrl });
    try {
      await client.connect();
      await client.end();
      return;
    } catch {
      await client.end().catch(() => undefined);
      await delay(READINESS_INTERVAL_MS);
    }
  }
  throw new Error(
    `Postgres did not accept connections within ` +
      `${(READINESS_ATTEMPTS * READINESS_INTERVAL_MS) / 1000}s.`,
  );
}

interface Server {
  superuserUrl: string;
  hostAndPort: string;
  stop(): Promise<void>;
}

/**
 * Docker assigns the host port when the container is created, but there is a
 * brief window right after `docker run` where it does not report it yet.
 */
async function readPublishedPort(containerName: string): Promise<string> {
  for (let attempt = 0; attempt < READINESS_ATTEMPTS; attempt += 1) {
    const { stdout } = await run("docker", ["port", containerName, "5432/tcp"]);
    const port = stdout.trim().split("\n")[0]?.split(":").at(-1);
    if (port) {
      return port;
    }
    await delay(READINESS_INTERVAL_MS);
  }
  throw new Error(`Could not read the published port of ${containerName}.`);
}

async function startContainer(): Promise<Server> {
  const containerName = `fleetapp-test-pg-${randomUUID()}`;
  const superuserPassword = randomUUID();

  await run("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    containerName,
    "--env",
    `POSTGRES_PASSWORD=${superuserPassword}`,
    "--publish",
    "127.0.0.1::5432",
    POSTGRES_IMAGE,
  ]);

  const stop = async (): Promise<void> => {
    await run("docker", ["rm", "--force", containerName]);
  };

  try {
    const hostAndPort = `127.0.0.1:${await readPublishedPort(containerName)}`;
    return {
      hostAndPort,
      superuserUrl: `postgres://postgres:${superuserPassword}@${hostAndPort}/postgres`,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

function useExistingServer(superuserUrl: string): Server {
  // `URL.host` already includes the port; `hostname` is the bare host.
  const { hostname, port } = new URL(superuserUrl);
  return {
    superuserUrl,
    hostAndPort: `${hostname}:${port || DEFAULT_POSTGRES_PORT}`,
    stop: async () => undefined,
  };
}

/**
 * Creates the roles the migrations grant to.
 *
 * The roles are created here rather than in a migration because roles are
 * cluster-level objects that Neon manages; a migration that created them would
 * work locally and fail in the environment that matters.
 *
 * Dropped first so a re-run against a server that is not thrown away starts
 * from the same state as a fresh container.
 */
async function provisionRoles(
  superuserUrl: string,
  roles: readonly string[],
  password: string,
): Promise<void> {
  const client = new Client({ connectionString: superuserUrl });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${TEST_DATABASE}`);
    for (const role of [OWNER_ROLE, ...roles]) {
      await client.query(`DROP ROLE IF EXISTS ${role}`);
      await client.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOBYPASSRLS`);
    }
    await client.query(`CREATE DATABASE ${TEST_DATABASE} OWNER ${OWNER_ROLE}`);
  } finally {
    await client.end();
  }
}

/**
 * Holds a lock for the life of the run.
 *
 * The roles the migrations grant to have fixed names, so two suites running at
 * once against one server would drop and recreate each other's roles halfway
 * through. Each run therefore waits its turn. A container is a fresh server
 * with nobody to wait for, so this costs nothing there.
 */
async function acquireProvisioningLock(superuserUrl: string): Promise<() => Promise<void>> {
  const client = new Client({ connectionString: superuserUrl });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [PROVISIONING_LOCK_KEY]);
  } catch (error) {
    await client.end();
    throw error;
  }
  return async () => {
    // Ending the session releases the lock; this is belt and braces.
    await client
      .query("SELECT pg_advisory_unlock($1)", [PROVISIONING_LOCK_KEY])
      .catch(() => undefined);
    await client.end();
  };
}

export async function startTestPostgres(roles: readonly string[]): Promise<TestPostgres> {
  const existingServerUrl = process.env[EXISTING_SERVER_ENV_VAR];
  const server = existingServerUrl ? useExistingServer(existingServerUrl) : await startContainer();

  let releaseLock: (() => Promise<void>) | undefined;

  try {
    await waitUntilAccepting(server.superuserUrl);

    releaseLock = await acquireProvisioningLock(server.superuserUrl);

    // A throwaway password for a throwaway database. Generated rather than
    // hardcoded so it never looks like a credential worth reusing.
    const password = randomUUID();
    await provisionRoles(server.superuserUrl, roles, password);

    return {
      superuserUrl: withDatabase(server.superuserUrl, TEST_DATABASE),
      ownerUrl: connectionUrl(OWNER_ROLE, password, server.hostAndPort),
      urlForRole: (role) => connectionUrl(role, password, server.hostAndPort),
      stop: async () => {
        await releaseLock?.();
        await server.stop();
      },
    };
  } catch (error) {
    await releaseLock?.();
    await server.stop();
    throw error;
  }
}
