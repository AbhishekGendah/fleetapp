import { SAMPLE_JPEG } from "@fleetapp/core/testing";
import { activityLog, files, rentals } from "@fleetapp/db/schema";
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
import { cancelRental } from "../src/lib/rentals/rental-records";
import { RENTAL_RETENTION_HOLDS } from "../src/lib/rentals/retention-holds";
import { emptyRenterForm, parseRenterForm } from "../src/lib/renters/renter-input";
import { createRenter } from "../src/lib/renters/renter-records";
import {
  binExpiredLicenceScans,
  countScansDueWith,
  loadRenterScanHold,
  NO_HOLDS,
  type RetentionHolds,
} from "../src/lib/renters/scan-retention";
import { saveOperatorSettings } from "../src/lib/settings/operator-settings";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";
import { seedOperatorWithUser } from "./car-fixtures";
import { bookTestRental } from "./rental-fixtures";
import { LINK_PHOTO } from "./renter-link-fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;
const JPEG_START = SAMPLE_JPEG;

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
    expect(await confirmUpload(deps, owner, start.fileId, ["renter_licence_scan"])).toBe(
      "confirmed",
    );
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
    await binExpiredLicenceScans(deps, NO_HOLDS);
    expect(await hasFront(actor, old.renterId)).toBe(false);
    expect(await hasFront(actor, recent.renterId)).toBe(true);
    expect(await listSidesDeletedByTimer(web.db, actor.operatorId, old.renterId)).toEqual(
      new Map([["front", 12]]),
    );

    const [logLine] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ actorType: activityLog.actorType, after: activityLog.valuesAfter })
        .from(activityLog)
        .where(and(eq(activityLog.entityId, old.scanId), eq(activityLog.action, "deleted"))),
    );
    expect(logLine).toEqual({
      actorType: "system",
      after: { purpose: "renter_licence_scan", reason: "kept_the_set_time", keptMonths: 12 },
    });
    const again = await binExpiredLicenceScans(deps, NO_HOLDS);
    expect(again.failedOperators).toBe(0);
    expect(await hasFront(actor, recent.renterId)).toBe(true);
  });

  it("counts the scans a lower setting would delete, before it is saved", async () => {
    const counter = await seedOperatorWithUser(admin, "Counting Retention Pty Ltd");
    await renterWithScan(counter, 100);
    await renterWithScan(counter, 10);
    const count = (months: number) =>
      countScansDueWith(web.db, counter.operatorId, months, new Date(), NO_HOLDS);
    expect(await count(12)).toBe(0);
    expect(await count(3)).toBe(1);
    expect(await count(1)).toBe(1);
  });

  it("follows each Operator's own setting, and never another's", async () => {
    const mine = await renterWithScan(actor, 100);
    const theirs = await renterWithScan(otherActor, 100);
    await saveOperatorSettings(web.db, actor, { licenceScanKeptMonths: 3 });
    await binExpiredLicenceScans(deps, NO_HOLDS);
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

  describe("with real rentals", () => {
    const bookFor = async (owner: ActingUser, renterId: string): Promise<string> =>
      (await bookTestRental(web, owner, renterId)).rentalId;

    it("keeps the scans of a Renter with a booking, and lets go once it is cancelled", async () => {
      const owner = await seedOperatorWithUser(admin, "Booked Retention Pty Ltd");
      const booked = await renterWithScan(owner, 400);
      const rentalId = await bookFor(owner, booked.renterId);

      await binExpiredLicenceScans(deps, RENTAL_RETENTION_HOLDS);
      expect(await hasFront(owner, booked.renterId)).toBe(true);
      // The Renter's Licence tab sees the same hold, so it never promises a date.
      expect(
        await loadRenterScanHold(web.db, owner.operatorId, booked.renterId, RENTAL_RETENTION_HOLDS),
      ).toEqual({ isHeld: true, lastRentalEndedAt: null });

      await cancelRental(web.db, owner, rentalId, { reason: "No longer needed" }, new Date());
      await binExpiredLicenceScans(deps, RENTAL_RETENTION_HOLDS);
      expect(await hasFront(owner, booked.renterId)).toBe(false);
    });

    it("counts from the last return once the rental is closed", async () => {
      const owner = await seedOperatorWithUser(admin, "Returned Retention Pty Ltd");
      const returned = await renterWithScan(owner, 400);
      const rentalId = await bookFor(owner, returned.renterId);
      // Handover and return come in later slices; the test moves the rental on itself.
      const moveTo = (changes: Partial<typeof rentals.$inferInsert>) =>
        withTenant(web.db, owner.operatorId, (tx) =>
          tx.update(rentals).set(changes).where(eq(rentals.id, rentalId)),
        );
      await moveTo({ status: "active", handedOverAt: new Date(Date.now() - 60 * DAY_MS) });
      await moveTo({ status: "returned", returnedAt: new Date(Date.now() - 30 * DAY_MS) });
      await moveTo({ status: "closed" });

      expect(await countScansDueWith(web.db, owner.operatorId, 12, new Date(), NO_HOLDS)).toBe(1);
      expect(
        await countScansDueWith(web.db, owner.operatorId, 12, new Date(), RENTAL_RETENTION_HOLDS),
      ).toBe(0);
      expect(
        await countScansDueWith(web.db, owner.operatorId, 1, new Date(), RENTAL_RETENTION_HOLDS),
      ).toBe(0);
    });

    it("lets go after a return, even though nothing closes the rental (review G8-5)", async () => {
      const owner = await seedOperatorWithUser(admin, "Returned Unclosed Retention Pty Ltd");
      const returned = await renterWithScan(owner, 400);
      const rentalId = await bookFor(owner, returned.renterId);
      const moveTo = (changes: Partial<typeof rentals.$inferInsert>) =>
        withTenant(web.db, owner.operatorId, (tx) =>
          tx.update(rentals).set(changes).where(eq(rentals.id, rentalId)),
        );
      await moveTo({ status: "active", handedOverAt: new Date(Date.now() - 90 * DAY_MS) });
      await moveTo({ status: "returned", returnedAt: new Date(Date.now() - 40 * DAY_MS) });

      // Left at "returned" for good: one month after it came back, the scan goes.
      expect(
        await countScansDueWith(web.db, owner.operatorId, 1, new Date(), RENTAL_RETENTION_HOLDS),
      ).toBe(1);
      expect(
        await countScansDueWith(web.db, owner.operatorId, 12, new Date(), RENTAL_RETENTION_HOLDS),
      ).toBe(0);
    });
  });
});
