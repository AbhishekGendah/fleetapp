import { DEFAULT_HANDOVER_PHOTOS } from "@fleetapp/core";
import {
  files,
  inspections,
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
import { completeHandover } from "../src/lib/handover/complete-handover";
import type { ChecklistPhotoTarget } from "../src/lib/handover/handover-photos";
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
import { TEST_TIME_ZONE } from "./rental-fixtures";
import { checklistKit, TEST_DETAILS, TEST_SIGNATURE } from "./handover-fixtures";

describe("handing a car over", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let storage: MemoryFileStorage;
  let sentEmails: EmailMessage[];
  let actor: ActingUser;
  let otherOperator: ActingUser;

  let kit: ReturnType<typeof checklistKit>;
  const handoverDeps = () => kit.handoverDeps();
  const clock = () => ({ timeZone: TEST_TIME_ZONE, now: new Date() });
  const readyRental = (options: { isBondHeld?: boolean } = {}) => kit.readyRental(options);
  const takePhoto = (inspectionId: string, target: ChecklistPhotoTarget) =>
    kit.takePhoto(inspectionId, target);
  const filledHandover = (rentalId: string) => kit.filledHandover(rentalId);

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    storage = createMemoryFileStorage();
    sentEmails = [];
    actor = await seedOperatorWithUser(admin, "Handover Rentals Pty Ltd");
    otherOperator = await seedOperatorWithUser(admin, "Other Handover Rentals Pty Ltd");
    kit = checklistKit(web, storage, sentEmails, actor);
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
      ...TEST_DETAILS,
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
    const input = {
      drawnSignature: TEST_SIGNATURE,
      bondOverrideReason: null,
      directDebitOverrideReason: null,
    };

    const withGap = await completeHandover(handoverDeps(), actor, inspectionId, input, clock());
    await takePhoto(inspectionId, { damageMarkId: added.status === "added" ? added.markId : "" });
    const bondShort = await completeHandover(handoverDeps(), actor, inspectionId, input, clock());

    expect(withGap).toEqual({ status: "gaps", gaps: [{ kind: "damage_photo" }] });
    expect(bondShort).toEqual({ status: "bond_short", owingCents: 500_00, onItsWayCents: 0 });
  });

  it("hands the car over on acceptance: report fixed, rental active, possession, Rented, kilometres, copies", async () => {
    const { rentalId, vehicleId } = await readyRental();
    const inspectionId = await filledHandover(rentalId);
    sentEmails.length = 0;

    const result = await completeHandover(
      handoverDeps(),
      actor,
      inspectionId,
      { drawnSignature: TEST_SIGNATURE, bondOverrideReason: null, directDebitOverrideReason: null },
      clock(),
    );
    const again = await completeHandover(
      handoverDeps(),
      actor,
      inspectionId,
      { drawnSignature: TEST_SIGNATURE, bondOverrideReason: null, directDebitOverrideReason: null },
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
    // The report's copy, and the first week's invoice issued with the handover.
    expect(sentEmails.map((email) => [email.to, email.attachments?.length])).toEqual([
      ["rory.ready@example.test", 1],
      ["rory.ready@example.test", 1],
    ]);
    expect(sentEmails.map((email) => email.subject)).toContainEqual(
      expect.stringMatching(/^(Tax invoice|Invoice) [A-Z0-9-]*\d+ from /),
    );
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
      {
        drawnSignature: TEST_SIGNATURE,
        bondOverrideReason: "Paying the bond on Friday",
        directDebitOverrideReason: null,
      },
      clock(),
    );

    expect(result.status).toBe("completed");
  });

  it("keeps an override reason only when the override was needed (review KS-8)", async () => {
    const { rentalId } = await readyRental({ isBondHeld: true });
    const inspectionId = await filledHandover(rentalId);

    const result = await completeHandover(
      handoverDeps(),
      actor,
      inspectionId,
      {
        drawnSignature: TEST_SIGNATURE,
        bondOverrideReason: "Typed before the bond came in",
        directDebitOverrideReason: "Typed before the direct debit was set up",
      },
      clock(),
    );

    expect(result.status).toBe("completed");
    const [kept] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({
          bond: inspections.bondOverrideReason,
          directDebit: inspections.directDebitOverrideReason,
        })
        .from(inspections)
        .where(eq(inspections.id, inspectionId)),
    );
    expect(kept).toEqual({ bond: null, directDebit: null });
  });
});
