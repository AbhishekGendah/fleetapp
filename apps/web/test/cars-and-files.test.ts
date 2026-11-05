import { SAMPLE_JPEG, SAMPLE_PDF } from "@fleetapp/core/testing";
import { files, insuranceClaims, rentals, vehicles } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailMessage } from "@fleetapp/email";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { recordFoundDamage } from "../src/lib/damage/damage-records";
import { removeAttachment, startAttachmentUpload } from "../src/lib/files/attachments";
import { removeCarFile, startCarPhotoUpload } from "../src/lib/files/car-files";
import { runFileHousekeeping } from "../src/lib/files/file-housekeeping";
import { moveOldPhotosToLongTermStorage } from "../src/lib/files/long-term-storage";
import { listRemovedCarFiles, restoreCarFile } from "../src/lib/files/removed-files";
import { confirmUpload, type FileDependencies } from "../src/lib/files/stored-files";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";
import {
  emptyPurchaseForm,
  parseCostForm,
  parsePurchaseForm,
} from "../src/lib/vehicles/cost-input";
import { loadCarCosts } from "../src/lib/vehicles/cost-queries";
import { addCost, archiveCost } from "../src/lib/vehicles/cost-records";
import { archiveVehicle, changeVehicleStatus } from "../src/lib/vehicles/vehicle-records";
import { addTestCar, seedOperatorWithUser } from "./car-fixtures";
import { checklistKit } from "./handover-fixtures";
import { TEST_TIME_ZONE } from "./rental-fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;
const PHOTO = { contentType: "image/jpeg", sizeBytes: 400_000 };
const THUMBNAIL = { contentType: "image/jpeg", sizeBytes: 30_000 };
const PDF = { contentType: "application/pdf", sizeBytes: 40_000 };

/** Batch 7, slice C: cars and their files (review A7-3, A7-4, A7-5, A8-5, A8-6, A8-7, G8-7). */
describe("cars and their files", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let superuser: TestConnection;
  let storage: MemoryFileStorage;
  let deps: FileDependencies;
  let actor: ActingUser;
  let kit: ReturnType<typeof checklistKit>;

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    superuser = connectAs(inject("superuserUrl"));
    storage = createMemoryFileStorage();
    deps = { database: web.db, storage, now: () => new Date() };
    actor = await seedOperatorWithUser(admin, "Cars And Files Pty Ltd");
    kit = checklistKit(web, storage, [] as EmailMessage[], actor);
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close(), superuser.close()]);
  });

  async function addPhoto(vehicleId: string, damageId?: string) {
    const start = await startCarPhotoUpload(
      deps,
      actor,
      vehicleId,
      { photo: PHOTO, thumbnail: THUMBNAIL },
      TEST_TIME_ZONE,
      damageId ? { damageRecordId: damageId } : undefined,
    );
    if (start.status !== "allowed") {
      throw new Error("The photo was refused.");
    }
    const [photoPermission, thumbnailPermission] = storage.permissions.slice(-2);
    storage.receive("general", photoPermission!.key, SAMPLE_JPEG);
    storage.receive("general", thumbnailPermission!.key, SAMPLE_JPEG);
    await confirmUpload(deps, actor, start.photo.fileId, ["vehicle_photo"]);
    await confirmUpload(deps, actor, start.thumbnail.fileId, ["vehicle_photo_thumbnail"]);
    return { photoId: start.photo.fileId, thumbnailId: start.thumbnail.fileId };
  }

  async function deletedAt(ids: string[]) {
    const rows = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select({ deletedAt: files.deletedAt }).from(files).where(inArray(files.id, ids)),
    );
    return rows.map((row) => row.deletedAt);
  }

  /** Dates a file's removal back, as only the superuser can. */
  async function removedDaysAgo(fileId: string, days: number) {
    await superuser.db
      .update(files)
      .set({ deletedAt: new Date(Date.now() - days * DAY_MS) })
      .where(eq(files.id, fileId));
  }

  it("brings back a removed photo with its small copy, within 30 days only (review A7-4)", async () => {
    const carId = await addTestCar(web, actor);
    const recent = await addPhoto(carId);
    const old = await addPhoto(carId);
    await removeCarFile(deps, actor, carId, recent.photoId);
    await removeCarFile(deps, actor, carId, old.photoId);
    await removedDaysAgo(old.photoId, 31);

    const listed = await listRemovedCarFiles(web.db, actor.operatorId, carId, new Date());
    const restored = await restoreCarFile(deps, actor, carId, recent.photoId);
    const tooLate = await restoreCarFile(deps, actor, carId, old.photoId);

    expect(listed.map((file) => file.id)).toEqual([recent.photoId]);
    expect(restored).toBe("restored");
    expect(await deletedAt([recent.photoId, recent.thumbnailId])).toEqual([null, null]);
    expect(tooLate).toBe("not_found");
  });

  it("keeps a removed receipt 5 years, and it can be brought back (review G8-7)", async () => {
    const carId = await addTestCar(web, actor);
    await addCost(
      web.db,
      actor,
      carId,
      parseCostForm({
        incurredOn: "2026-10-30",
        kind: "repair",
        description: "Tyres",
        costCents: "440",
        gstCents: "40",
      }).data!,
    );
    const costId = (await loadCarCosts(web.db, actor.operatorId, carId)).costs[0]!.id;
    const start = await startAttachmentUpload(deps, actor, { kind: "cost", id: costId }, PDF);
    const fileId = start.status === "allowed" ? start.fileId : "";
    const permission = storage.permissions.at(-1)!;
    storage.receive(permission.area, permission.key, SAMPLE_PDF);
    await confirmUpload(deps, actor, fileId, ["vehicle_attachment"]);
    await removeAttachment(deps, actor, fileId);
    await removedDaysAgo(fileId, 40);

    await runFileHousekeeping(deps);
    const [kept] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select({ purgedAt: files.purgedAt }).from(files).where(eq(files.id, fileId)),
    );
    const listed = await listRemovedCarFiles(web.db, actor.operatorId, carId, new Date());

    expect(kept?.purgedAt).toBeNull();
    expect(listed).toContainEqual(expect.objectContaining({ id: fileId, kind: "paper" }));
    expect(await restoreCarFile(deps, actor, carId, fileId)).toBe("restored");
  });

  it("won't remove a damage photo while its claim is open (decision 3)", async () => {
    const carId = await addTestCar(web, actor);
    const added = await recordFoundDamage(web.db, actor, carId, {
      x: null,
      y: null,
      rentalId: null,
      foundOn: "2026-11-01",
      description: "Dent in door",
    });
    const damageId = added.status === "added" ? added.damageId : "";
    const { photoId } = await addPhoto(carId, damageId);
    await withTenant(web.db, actor.operatorId, (tx) =>
      tx.insert(insuranceClaims).values({
        operatorId: actor.operatorId,
        damageRecordId: damageId,
        insurer: "Example Insurance",
        status: "lodged",
      }),
    );

    expect(await removeCarFile(deps, actor, carId, photoId)).toBe("held");
    await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .update(insuranceClaims)
        .set({ status: "paid" })
        .where(eq(insuranceClaims.damageRecordId, damageId)),
    );
    expect(await removeCarFile(deps, actor, carId, photoId)).toBe("removed");
  });

  it("leaves an archived car's records as they are, even from a page left open (review A8-7)", async () => {
    const carId = await addTestCar(web, actor);
    await addCost(
      web.db,
      actor,
      carId,
      parseCostForm({
        incurredOn: "2026-10-30",
        kind: "repair",
        description: "Wipers",
        costCents: "40",
        gstCents: "",
      }).data!,
    );
    const costId = (await loadCarCosts(web.db, actor.operatorId, carId)).costs[0]!.id;
    const { photoId } = await addPhoto(carId);
    await archiveVehicle(web.db, actor, carId);

    expect(await archiveCost(web.db, actor, costId)).toBe("not_found");
    expect(await removeCarFile(deps, actor, carId, photoId)).toBe("not_found");
  });

  it("sets Sold only by recording a sale, and never undoes it from the Status box (review A8-5)", async () => {
    const carId = await addTestCar(web, actor);
    const toSold = await changeVehicleStatus(web.db, actor, carId, {
      status: "sold",
      statusReason: null,
      statusExpectedBack: null,
    });
    await withTenant(web.db, actor.operatorId, (tx) =>
      tx.update(vehicles).set({ status: "sold" }).where(eq(vehicles.id, carId)),
    );
    const fromSold = await changeVehicleStatus(web.db, actor, carId, {
      status: "available",
      statusReason: null,
      statusExpectedBack: null,
    });

    expect(toSold).toBe("sale_only");
    expect(fromSold).toBe("sale_only");
  });

  it("refuses a purchase dated after today (review A8-6)", () => {
    const form = {
      ...emptyPurchaseForm(),
      purchasedOn: "2026-11-06",
      source: "dealer",
      sellerName: "Example Motors",
      priceCents: "20,000",
      gstCents: "1,818.18",
    };

    expect(parsePurchaseForm(form, "2026-11-05").success).toBe(false);
    expect(parsePurchaseForm(form, "2026-11-06").success).toBe(true);
  });

  it("bins the small copy of a photo whose upload never finished (review A7-5)", async () => {
    const carId = await addTestCar(web, actor);
    const start = await startCarPhotoUpload(
      deps,
      actor,
      carId,
      { photo: PHOTO, thumbnail: THUMBNAIL },
      TEST_TIME_ZONE,
    );
    if (start.status !== "allowed") {
      throw new Error("The photo was refused.");
    }
    const thumbnailPermission = storage.permissions.at(-1)!;
    storage.receive("general", thumbnailPermission.key, SAMPLE_JPEG);
    await confirmUpload(deps, actor, start.thumbnail.fileId, ["vehicle_photo_thumbnail"]);
    await superuser.db
      .update(files)
      .set({ createdAt: new Date(Date.now() - 2 * DAY_MS) })
      .where(eq(files.id, start.photo.fileId));

    await runFileHousekeeping(deps);

    expect(await deletedAt([start.thumbnail.fileId])).toEqual([expect.any(Date)]);
  });

  it("moves a checklist's photos to long-term storage a year after the rental came back (rule 23)", async () => {
    const out = await kit.rentalOut(new Date(Date.now() - 2 * DAY_MS));
    await superuser.db
      .update(rentals)
      .set({
        status: "returned",
        handedOverAt: new Date(Date.now() - 410 * DAY_MS),
        returnedAt: new Date(Date.now() - 400 * DAY_MS),
      })
      .where(eq(rentals.id, out.rentalId));
    const [checklistPhoto] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ id: files.id, objectKey: files.objectKey })
        .from(files)
        .where(eq(files.vehicleId, out.vehicleId)),
    );

    const summary = await moveOldPhotosToLongTermStorage(deps);
    const again = await moveOldPhotosToLongTermStorage(deps);
    const [moved] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ at: files.longTermStorageAt })
        .from(files)
        .where(eq(files.id, checklistPhoto!.id)),
    );

    expect(summary.done).toBeGreaterThan(0);
    expect(again.done).toBe(0);
    expect(moved?.at).toEqual(expect.any(Date));
    expect(storage.longTerm.has(`general:${checklistPhoto!.objectKey}`)).toBe(true);
  });
});
