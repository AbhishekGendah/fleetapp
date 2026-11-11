import { drizzle } from "drizzle-orm/neon-serverless";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";

import { createDb, type AnyDatabase } from "../src/client";
import * as schema from "../src/schema";
import { withTenant } from "../src/tenant-context";
import { assertTransactionsHold, transactionProblems } from "../src/transaction-check";
import {
  connectAs,
  POSTGRES_ERROR_CODES,
  postgresErrorCodeOf,
  seedTwoOperators,
  type TestConnection,
} from "./fixtures";
import { startNeonBridge, type NeonBridge } from "./neon-bridge";

/** Statements at once inside one transaction, as the bond records' reads are. */
const PARALLEL_READS = 3;

/**
 * Transactions on Neon's real driver (the live site's), reached through a
 * local relay. On the dev site from 5 to 11 Nov 2026 the start-up hook, bundled
 * with its own copy of the driver, made the shared pool; the pages' copy of
 * Drizzle then did not hold a transaction to one connection, and a write
 * after reads made at once ran with no business set: "new row violates
 * row-level security policy" on the demo data's bonds.
 */
describe("transactions on Neon's driver", () => {
  let admin: TestConnection;
  let bridge: NeonBridge;
  let webUrl: string;
  let operatorId: string;
  const closers: Array<() => Promise<void>> = [];

  beforeAll(async () => {
    admin = connectAs(inject("adminRoleUrl"));
    ({ operatorAId: operatorId } = await seedTwoOperators(admin.db));
    bridge = await startNeonBridge();
    webUrl = bridge.bridged(inject("webRoleUrl"));
  });

  afterAll(async () => {
    for (const close of closers) {
      await close();
    }
    await admin.close();
    await bridge.close();
  });

  /** Reads made at once, then a write, in one tenant transaction (as recording a bond does). */
  function readAtOnceThenWrite(database: AnyDatabase): Promise<unknown> {
    return withTenant(database, operatorId, async (tx) => {
      await Promise.all(
        Array.from({ length: PARALLEL_READS }, () => tx.select().from(schema.operatorSettings)),
      );
      await tx.insert(schema.operatorSettings).values({ operatorId, settings: {} });
      // Undone, so each test starts from no settings row.
      throw new RolledBack();
    });
  }

  class RolledBack extends Error {}

  it("fails as the dev site did on a pool made by another copy of the driver, and the start-up check says so", async () => {
    const pool = new bridge.secondDriverCopy.Pool({ connectionString: webUrl });
    closers.push(() => pool.end());
    // Drizzle's own copy of the driver does not recognise this pool as one of its own.
    const database = drizzle(pool as never, { schema }) as unknown as AnyDatabase;

    expect(await postgresErrorCodeOf(readAtOnceThenWrite(database))).toBe(
      POSTGRES_ERROR_CODES.insufficientPrivilege,
    );
    expect(await transactionProblems(database)).not.toEqual([]);
    await expect(assertTransactionsHold(database, "app")).rejects.toThrow(
      /does not keep a transaction together/,
    );
  });

  it("never hands the pages a pool another copy of this module made with its own driver", async () => {
    // The start-up hook's copy: this module again, on the second copy of the driver.
    vi.resetModules();
    vi.doMock("@neondatabase/serverless", () => bridge.secondDriverCopy);
    const startupCopy = await import("../src/client");
    vi.doUnmock("@neondatabase/serverless");
    startupCopy.createDb(webUrl);

    const database = createDb(webUrl);
    expect(await transactionProblems(database)).toEqual([]);
    await expect(readAtOnceThenWrite(database)).rejects.toBeInstanceOf(RolledBack);
    closers.push(() => endPoolsOf(webUrl));
  });
});

/** Ends every pool either copy keeps for this address, so the run leaves nothing open. */
async function endPoolsOf(connectionString: string): Promise<void> {
  const byDriver = globalThis.__fleetappDbPoolsByDriver ?? new Map();
  for (const pools of byDriver.values()) {
    await pools.get(connectionString)?.end();
    pools.delete(connectionString);
  }
}
