import { DEFAULT_HANDOVER_PHOTOS } from "@fleetapp/core";
import { SAMPLE_JPEG } from "@fleetapp/core/testing";
import {
  files,
  issuedDocuments,
  odometerReadings,
  possessions,
  rentals,
  vehicles,
} from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailMessage } from "@fleetapp/email";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { recordBondReceived } from "../src/lib/bonds/bond-records";
import { issueDocument } from "../src/lib/contracts/issued-documents";
import { confirmUpload, type FileDependencies } from "../src/lib/files/stored-files";
import { completeHandover } from "../src/lib/handover/complete-handover";
import {
  startChecklistPhotoUpload,
  type ChecklistPhotoTarget,
} from "../src/lib/handover/handover-photos";
import { loadHandover } from "../src/lib/handover/handover-queries";
import {
  addDamageMark,
  cancelHandover,
  removeDamageMark,
  saveHandoverDetails,
  startHandover,
} from "../src/lib/handover/handover-records";
import { changeVehicleStatus } from "../src/lib/vehicles/vehicle-records";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";
import { seedOperatorWithUser } from "./car-fixtures";
import { addRenterReadyToRent, bookTestRental, TEST_TIME_ZONE } from "./rental-fixtures";
import { recordingEmailSender } from "./renter-link-fixtures";

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const SIGNATURE = `data:image/png;base64,${btoa(String.fromCharCode(...PNG_HEADER, 1, 2, 3))}`;
const PHOTO_SIZES = { contentType: "image/jpeg", sizeBytes: 300_000 };
const DETAILS = { fuelLevel: "full" as const, keysCount: 2, accessories: null, notes: null };

describe("handing a car over", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let storage: MemoryFileStorage;
  let sentEmails: EmailMessage[];
  let actor: ActingUser;
  let otherOperator: ActingUser;

  const deps = (): FileDependencies & { storage: MemoryFileStorage } => ({
    database: web.db,
    storage,
    now: () => new Date(),
  });
  const handoverDeps = () => ({ ...deps(), emailSender: recordingEmailSender(sentEmails) });
  const clock = () => ({ timeZone: TEST_TIME_ZONE, now: new Date() });

  /** A booked rental for a Renter with everything on file, its contract signed and bond held. */
  async function readyRental(options: { isBondHeld?: boolean } = {}) {
    const renterId = await addRenterReadyToRent(web, deps(), actor);
    const booked = await bookTestRental(web, actor, renterId);
    await issueDocument(deps(), actor, {
      rentalId: booked.rentalId,
      kind: "contract",
      templateVersionId: null,
      pdf: new TextEncoder().encode("%PDF-1.4 signed"),
    });
    if (options.isBondHeld !== false) {
      await recordBondReceived(web.db, actor, booked.rentalId, {
        amountCents: 500_00,
        method: "cash",
        reference: null,
        occurredOn: "2026-10-30",
      });
    }
    return booked;
  }

  async function takePhoto(inspectionId: string, target: ChecklistPhotoTarget): Promise<string> {
    const start = await startChecklistPhotoUpload(
      deps(),
      actor,
      inspectionId,
      target,
      { photo: PHOTO_SIZES, thumbnail: { ...PHOTO_SIZES, sizeBytes: 30_000 } },
      TEST_TIME_ZONE,
    );
    if (start.status !== "allowed") {
      throw new Error(`The photo was not allowed: ${start.status}`);
    }
    const photoPermission = storage.permissions.at(-2)!;
    storage.receive(photoPermission.area, photoPermission.key, SAMPLE_JPEG);
    expect(await confirmUpload(deps(), actor, start.photo.fileId, ["vehicle_photo"])).toBe(
      "confirmed",
    );
    return start.photo.fileId;
  }

  /** A checklist with every photo taken and the details saved. */
  async function filledHandover(rentalId: string): Promise<string> {
    const started = await startHandover(web.db, actor, rentalId);
    const inspectionId = "inspectionId" in started ? started.inspectionId : "";
    for (const photoName of DEFAULT_HANDOVER_PHOTOS) {
      await takePhoto(inspectionId, { photoName });
    }
    await saveHandoverDetails(web.db, actor, inspectionId, { ...DETAILS, odometerKm: 12_500 });
    return inspectionId;
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    storage = createMemoryFileStorage();
    sentEmails = [];
    actor = await seedOperatorWithUser(admin, "Handover Rentals Pty Ltd");
    otherOperator = await seedOperatorWithUser(admin, "Other Handover Rentals Pty Ltd");
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  it("starts one checklist per rental with the rental's photo list, and keeps it from other Operators", async () => {
    const { rentalId } = await readyRental();

    const started = await startHandover(web.db, actor, rentalId);
    const again = await startHandover(web.db, actor, rentalId);
    const inspectionId = started.status === "started" ? started.inspectionId : "";
    const view = await loadHandover(web.db, actor.operatorId, inspectionId);

    expect(again).toEqual({ status: "resumed", inspectionId });
    expect(view?.photoNames).toEqual([...DEFAULT_HANDOVER_PHOTOS]);
    expect(view?.gaps).toHaveLength(DEFAULT_HANDOVER_PHOTOS.length + 3);
    expect(await loadHandover(web.db, otherOperator.operatorId, inspectionId)).toBeNull();
    expect(await startHandover(web.db, otherOperator, rentalId)).toEqual({ status: "not_found" });
  });

  it("replaces a photo taken again, and refuses kilometres below the car's last reading", async () => {
    const { rentalId } = await readyRental();
    const started = await startHandover(web.db, actor, rentalId);
    const inspectionId = "inspectionId" in started ? started.inspectionId : "";

    const first = await takePhoto(inspectionId, { photoName: "Front" });
    const second = await takePhoto(inspectionId, { photoName: "Front" });
    const lower = await saveHandoverDetails(web.db, actor, inspectionId, {
      ...DETAILS,
      odometerKm: 10,
    });
    const view = await loadHandover(web.db, actor.operatorId, inspectionId);
    const [firstRow] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select({ deletedAt: files.deletedAt }).from(files).where(eq(files.id, first)),
    );

    expect(view?.photos.get("Front")?.fileId).toBe(second);
    expect(firstRow?.deletedAt).not.toBeNull();
    expect(lower).toEqual({ status: "lower", lastKilometres: 12_000 });
  });

  it("refuses the acceptance while photos are missing, a damage mark has no photo, or the bond is short", async () => {
    const { rentalId } = await readyRental({ isBondHeld: false });
    const inspectionId = await filledHandover(rentalId);
    const added = await addDamageMark(web.db, actor, inspectionId, {
      x: 500,
      y: 300,
      description: "Scratch on bonnet",
    });
    const input = { drawnSignature: SIGNATURE, bondOverrideReason: null };

    const withGap = await completeHandover(handoverDeps(), actor, inspectionId, input, clock());
    await takePhoto(inspectionId, { damageMarkId: added.status === "added" ? added.markId : "" });
    const bondShort = await completeHandover(handoverDeps(), actor, inspectionId, input, clock());

    expect(withGap).toEqual({ status: "gaps", gaps: [{ kind: "damage_photo" }] });
    expect(bondShort).toEqual({ status: "bond_short", owingCents: 500_00 });
  });

  it("hands the car over on acceptance: report fixed, rental active, possession, Rented, kilometres, copies", async () => {
    const { rentalId, vehicleId } = await readyRental();
    const inspectionId = await filledHandover(rentalId);
    sentEmails.length = 0;

    const result = await completeHandover(
      handoverDeps(),
      actor,
      inspectionId,
      { drawnSignature: SIGNATURE, bondOverrideReason: null },
      clock(),
    );
    const again = await completeHandover(
      handoverDeps(),
      actor,
      inspectionId,
      { drawnSignature: SIGNATURE, bondOverrideReason: null },
      clock(),
    );

    expect(result.status).toBe("completed");
    expect(again).toEqual({ status: "finished_already" });
    const state = await withTenant(web.db, actor.operatorId, async (tx) => ({
      rental: (await tx.select().from(rentals).where(eq(rentals.id, rentalId)))[0],
      car: (await tx.select().from(vehicles).where(eq(vehicles.id, vehicleId)))[0],
      open: await tx
        .select()
        .from(possessions)
        .where(and(eq(possessions.rentalId, rentalId), isNull(possessions.endedAt))),
      report: await tx
        .select()
        .from(issuedDocuments)
        .where(
          and(eq(issuedDocuments.rentalId, rentalId), eq(issuedDocuments.kind, "handover_report")),
        ),
      reading: await tx
        .select()
        .from(odometerReadings)
        .where(
          and(eq(odometerReadings.vehicleId, vehicleId), eq(odometerReadings.source, "handover")),
        ),
    }));
    expect(state.rental).toMatchObject({ status: "active" });
    expect(state.rental?.handedOverAt).not.toBeNull();
    expect(state.car?.status).toBe("rented");
    expect(state.open).toHaveLength(1);
    expect(state.report).toMatchObject([{ inspectionId }]);
    expect(state.reading).toMatchObject([{ kilometres: 12_500 }]);
    expect(sentEmails.map((email) => [email.to, email.attachments?.length])).toEqual([
      ["rory.ready@example.test", 1],
    ]);
    expect(
      await changeVehicleStatus(web.db, actor, vehicleId, {
        status: "in_service",
        statusReason: null,
        statusExpectedBack: null,
      }),
    ).toBe("rented");
  });

  it("takes a damage mark off, and a cancelled checklist makes way for a new one", async () => {
    const { rentalId } = await readyRental();
    const started = await startHandover(web.db, actor, rentalId);
    const inspectionId = "inspectionId" in started ? started.inspectionId : "";
    const added = await addDamageMark(web.db, actor, inspectionId, {
      x: 10,
      y: 10,
      description: "Dent",
    });
    const markId = added.status === "added" ? added.markId : "";

    expect(await removeDamageMark(web.db, actor, inspectionId, markId)).toBe("removed");
    expect((await loadHandover(web.db, actor.operatorId, inspectionId))?.damageMarks).toEqual([]);
    expect(await cancelHandover(web.db, actor, inspectionId)).toBe("cancelled");
    expect((await startHandover(web.db, actor, rentalId)).status).toBe("started");
  });

  it("hands over with the bond short only with a reason", async () => {
    const { rentalId } = await readyRental({ isBondHeld: false });
    const inspectionId = await filledHandover(rentalId);

    const result = await completeHandover(
      handoverDeps(),
      actor,
      inspectionId,
      { drawnSignature: SIGNATURE, bondOverrideReason: "Paying the bond on Friday" },
      clock(),
    );

    expect(result.status).toBe("completed");
  });
});
