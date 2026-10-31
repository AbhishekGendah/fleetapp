import { activityLog, files } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { confirmUpload, type FileDependencies } from "../src/lib/files/stored-files";
import {
  listLicenceScans,
  listSidesDeletedByTimer,
  startLicenceScanUpload,
} from "../src/lib/renters/licence-scans";
import { emptyRenterForm, parseRenterForm } from "../src/lib/renters/renter-input";
import { createRenter } from "../src/lib/renters/renter-records";
import { binExpiredLicenceScans, type RetentionHolds } from "../src/lib/renters/scan-retention";
import { saveOperatorSettings } from "../src/lib/settings/operator-settings";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";
import { seedOperatorWithUser } from "./car-fixtures";
import { LINK_PHOTO } from "./renter-link-fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;
const JPEG_START = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);

describe("licence scans deleted on a timer", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let storage: MemoryFileStorage;
  let deps: FileDependencies;
  let actor: ActingUser;
  let otherActor: ActingUser;

  /** A Renter with a front scan added `daysAgo` days ago. */
  async function renterWithScan(owner: ActingUser, daysAgo: number) {
    const renterId = await createRenter(
      web.db,
      owner,
      parseRenterForm(
        { ...emptyRenterForm(), fullName: "Kept Renter", phone: "0412345678" },
        "2026-10-31",
      ).data!,
    );
    const start = await startLicenceScanUpload(deps, owner, renterId, "front", LINK_PHOTO);
    if (start.status !== "allowed") {
      throw new Error(start.status);
    }
    const permission = storage.permissions.at(-1)!;
    storage.receive(permission.area, permission.key, JPEG_START);
    expect(await confirmUpload(deps, owner, start.fileId)).toBe("confirmed");
    await withTenant(web.db, owner.operatorId, (tx) =>
      tx
        .update(files)
        .set({ confirmedAt: new Date(Date.now() - daysAgo * DAY_MS) })
        .where(eq(files.id, start.fileId)),
    );
    return { renterId, scanId: start.fileId };
  }

  async function hasFront(owner: ActingUser, renterId: string): Promise<boolean> {
    return (await listLicenceScans(web.db, owner.operatorId, renterId)).front !== null;
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    storage = createMemoryFileStorage();
    deps = { database: web.db, storage, now: () => new Date() };
    actor = await seedOperatorWithUser(admin, "Retention Pty Ltd");
    otherActor = await seedOperatorWithUser(admin, "Other Retention Pty Ltd");
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("bins a scan kept past the setting, keeps a newer one, and is safe to run again", async () => {
    const old = await renterWithScan(actor, 400);
    const recent = await renterWithScan(actor, 100);
    await binExpiredLicenceScans(deps);
    expect(await hasFront(actor, old.renterId)).toBe(false);
    expect(await hasFront(actor, recent.renterId)).toBe(true);
    expect(await listSidesDeletedByTimer(web.db, actor.operatorId, old.renterId)).toEqual(
      new Set(["front"]),
    );

    const [logLine] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ actorType: activityLog.actorType, after: activityLog.valuesAfter })
        .from(activityLog)
        .where(and(eq(activityLog.entityId, old.scanId), eq(activityLog.action, "deleted"))),
    );
    expect(logLine).toEqual({
      actorType: "system",
      after: { purpose: "renter_licence_scan", reason: "kept_the_set_time" },
    });
    const again = await binExpiredLicenceScans(deps);
    expect(again.failedOperators).toBe(0);
    expect(await hasFront(actor, recent.renterId)).toBe(true);
  });

  it("follows each Operator's own setting, and never another's", async () => {
    const mine = await renterWithScan(actor, 100);
    const theirs = await renterWithScan(otherActor, 100);
    await saveOperatorSettings(web.db, actor, { licenceScanKeptMonths: 3 });
    await binExpiredLicenceScans(deps);
    expect(await hasFront(actor, mine.renterId)).toBe(false);
    expect(await hasFront(otherActor, theirs.renterId)).toBe(true);
    await saveOperatorSettings(web.db, actor, { licenceScanKeptMonths: 12 });
  });

  it("keeps scans while a rental, fine or dispute is open, and counts from the last rental", async () => {
    const held = await renterWithScan(actor, 400);
    const rentedLately = await renterWithScan(actor, 400);
    const holds: RetentionHolds = {
      lastRentalEnds: async () =>
        new Map([[rentedLately.renterId, new Date(Date.now() - 30 * DAY_MS)]]),
      rentersWithOpenMatters: async () => new Set([held.renterId]),
    };
    await binExpiredLicenceScans(deps, holds);
    expect(await hasFront(actor, held.renterId)).toBe(true);
    expect(await hasFront(actor, rentedLately.renterId)).toBe(true);

    const bothScans = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ deletedAt: files.deletedAt })
        .from(files)
        .where(inArray(files.id, [held.scanId, rentedLately.scanId])),
    );
    expect(bothScans.every((scan) => scan.deletedAt === null)).toBe(true);
  });
});
