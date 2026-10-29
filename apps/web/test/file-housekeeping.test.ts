import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { buildFileKey, MILLISECONDS_PER_DAY } from "@fleetapp/core";
import { activityLog, files, operators } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { isScheduledJobRequest } from "../src/lib/cron-auth";
import { runFileHousekeeping } from "../src/lib/files/file-housekeeping";
import type { FileDependencies } from "../src/lib/files/stored-files";
import { FILE_HOUSEKEEPING_CRON_PATH } from "../src/lib/paths";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";

const HOUR_MS = MILLISECONDS_PER_DAY / 24;
const NOW = new Date();
const ago = (milliseconds: number): Date => new Date(NOW.getTime() - milliseconds);

describe("the daily file clean-up", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let storage: MemoryFileStorage;
  let deps: FileDependencies;
  let operatorId: string;

  /** A file in a given state, stored, as if it had been there a while. */
  async function seedFile(
    state: Partial<typeof files.$inferInsert>,
  ): Promise<{ id: string; key: string }> {
    const id = randomUUID();
    const key = buildFileKey(operatorId, "operator_logo", id);
    await withTenant(web.db, operatorId, (tx) =>
      tx.insert(files).values({
        id,
        operatorId,
        purpose: "operator_logo",
        storageArea: "general",
        objectKey: key,
        contentType: "image/png",
        sizeBytes: 100,
        ...state,
      }),
    );
    storage.receive("general", key, new Uint8Array([1]));
    return { id, key };
  }

  async function state(id: string) {
    const [row] = await admin.db
      .select({ purgedAt: files.purgedAt, refusedAt: files.refusedAt })
      .from(files)
      .where(eq(files.id, id));
    return row;
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    storage = createMemoryFileStorage();
    deps = { database: web.db, storage, now: () => NOW };
    const [operator] = await admin.db
      .insert(operators)
      .values({ legalName: "Clean-up Rentals" })
      .returning({ id: operators.id });
    operatorId = operator!.id;
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("removes files deleted over 30 days ago and uploads that never finished, and nothing else", async () => {
    const oldDeleted = await seedFile({
      confirmedAt: ago(40 * MILLISECONDS_PER_DAY),
      deletedAt: ago(31 * MILLISECONDS_PER_DAY),
    });
    const recentDeleted = await seedFile({
      confirmedAt: ago(20 * MILLISECONDS_PER_DAY),
      deletedAt: ago(10 * MILLISECONDS_PER_DAY),
    });
    const abandoned = await seedFile({ createdAt: ago(25 * HOUR_MS) });
    const inProgress = await seedFile({ createdAt: ago(HOUR_MS) });
    const inUse = await seedFile({ confirmedAt: ago(60 * MILLISECONDS_PER_DAY) });

    const summary = await runFileHousekeeping(deps);

    expect(summary).toMatchObject({ purged: 2, failedOperators: 0 });
    expect(storage.has("general", oldDeleted.key)).toBe(false);
    expect(storage.has("general", abandoned.key)).toBe(false);
    for (const kept of [recentDeleted, inProgress, inUse]) {
      expect(storage.has("general", kept.key)).toBe(true);
      expect((await state(kept.id))?.purgedAt).toBeNull();
    }
    expect((await state(oldDeleted.id))?.purgedAt).not.toBeNull();
    expect((await state(abandoned.id))?.refusedAt).not.toBeNull();
  });

  it("keeps the record, and logs each removal as done by the system", async () => {
    const lines = await admin.db
      .select({ actorType: activityLog.actorType, action: activityLog.action })
      .from(activityLog)
      .where(and(eq(activityLog.operatorId, operatorId), eq(activityLog.action, "purged")));

    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.actorType === "system")).toBe(true);
  });

  it("is safe to run again: nothing is removed twice", async () => {
    expect(await runFileHousekeeping(deps)).toMatchObject({ purged: 0 });
  });
});

describe("the scheduled job's lock", () => {
  const SECRET = "a-cron-secret-that-is-at-least-32-characters";

  it("opens only for the shared secret", () => {
    expect(isScheduledJobRequest(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isScheduledJobRequest(`Bearer wrong`, SECRET)).toBe(false);
    expect(isScheduledJobRequest(SECRET, SECRET)).toBe(false);
    expect(isScheduledJobRequest(null, SECRET)).toBe(false);
  });

  it("is what Vercel's scheduler calls", () => {
    const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
      crons: { path: string }[];
    };
    expect(config.crons.map((cron) => cron.path)).toContain(FILE_HOUSEKEEPING_CRON_PATH);
  });
});
