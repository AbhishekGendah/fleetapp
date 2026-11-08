import { randomUUID } from "node:crypto";

import { drawnSignatureInput } from "@fleetapp/core";
import {
  carHolds,
  carSwaps,
  inspections,
  issuedDocuments,
  possessions,
  rentals,
  vehicles,
  activityLog,
} from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailMessage } from "@fleetapp/email";
import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { createTemplate } from "../src/lib/contracts/templates";
import { completeReturn } from "../src/lib/handover/complete-return";
import {
  completeSwap,
  currentShownSwap,
  type CompleteSwapInput,
} from "../src/lib/handover/complete-swap";
import { loadReturn } from "../src/lib/handover/handover-queries";
import { addDamageMark, startReturn } from "../src/lib/handover/handover-records";
import { heldRange, isCarAlreadyHeld } from "../src/lib/rentals/car-holds";
import { cancelSwap, startSwap } from "../src/lib/rentals/car-swaps";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";
import { changeVehicleStatus } from "../src/lib/vehicles/vehicle-records";
import { addTestCar, seedOperatorWithUser } from "./car-fixtures";
import { checklistKit, HANDOVER_KM, TEST_SIGNATURE } from "./handover-fixtures";
import { addCarOut, LATE_HANDED_OVER, recordTestHandover, TEST_TIME_ZONE } from "./rental-fixtures";

const HOUR_MS = 60 * 60 * 1000;
/** The new car starts at 12,000 km (addTestCar); the old car went out at the handover's. */
const NEW_CAR_KM = 12_050;
const OLD_CAR_KM = HANDOVER_KM + 600;
const TO_WORKSHOP = {
  status: "in_service" as const,
  statusReason: "Gearbox",
  statusExpectedBack: "2027-12-01",
};

/** A swap that is no longer under way has nothing to show. */
const NOTHING_SHOWN = {
  swapId: "",
  returnFingerprint: "",
  handoverFingerprint: "",
  swapTemplateVersionId: "",
  swapFormFingerprint: "",
};

describe("swapping the Renter's car", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let superuser: TestConnection;
  let storage: MemoryFileStorage;
  let sentEmails: EmailMessage[];
  let actor: ActingUser;
  let otherOperator: ActingUser;
  let kit: ReturnType<typeof checklistKit>;

  const clock = () => ({ timeZone: TEST_TIME_ZONE, now: new Date() });
  /** What the signing step would send for the swap as it stands now. */
  async function swapInput(rentalId: string): Promise<CompleteSwapInput> {
    const shown = await currentShownSwap({ database: web.db }, actor.operatorId, rentalId, clock());
    return {
      shown: shown ?? NOTHING_SHOWN,
      signature: drawnSignatureInput(TEST_SIGNATURE),
      oldCarAfter: TO_WORKSHOP,
    };
  }

  async function swapUnderWayFor() {
    const out = await kit.rentalOut(new Date(Date.now() - 48 * HOUR_MS));
    const newCarId = await addTestCar(web, actor);
    const started = await startSwap(
      web.db,
      actor,
      out.rentalId,
      { toVehicleId: newCarId, reason: "Engine light on" },
      clock(),
    );
    const swapId = "swapId" in started ? started.swapId : "";
    const [swap] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select().from(carSwaps).where(eq(carSwaps.id, swapId)),
    );
    return { ...out, newCarId, swap: swap! };
  }

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    superuser = connectAs(inject("superuserUrl"));
    storage = createMemoryFileStorage();
    sentEmails = [];
    actor = await seedOperatorWithUser(admin, "Swapping Rentals Pty Ltd");
    otherOperator = await seedOperatorWithUser(admin, "Other Swapping Rentals Pty Ltd");
    kit = checklistKit(web, storage, sentEmails, actor);
    await createTemplate(web.db, actor, { kind: "swap_form", name: "Swap form" });
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close(), superuser.close()]);
  });

  it("starts only into an available car of this business, and refuses without a swap form", async () => {
    const out = await kit.rentalOut(new Date(Date.now() - 24 * HOUR_MS));
    const inWorkshop = await addTestCar(web, actor);
    await changeVehicleStatus(web.db, actor, inWorkshop, TO_WORKSHOP);
    const otherBusinessCar = await addTestCar(web, otherOperator);
    const start = (toVehicleId: string, owner = actor) =>
      startSwap(web.db, owner, out.rentalId, { toVehicleId, reason: "Flat tyre" }, clock());

    expect(await start(out.vehicleId)).toEqual({ status: "same_car" });
    expect(await start(inWorkshop)).toEqual({ status: "car_not_available" });
    expect(await start(otherBusinessCar)).toEqual({ status: "car_not_available" });
    expect(await start(inWorkshop, otherOperator)).toEqual({ status: "no_template" });
    const booked = await kit.readyRental();
    expect(
      await startSwap(
        web.db,
        actor,
        booked.rentalId,
        { toVehicleId: inWorkshop, reason: "x" },
        clock(),
      ),
    ).toEqual({ status: "not_out" });
  });

  /**
   * The status a car still out would never have: only this lets a swap reach
   * its late-car checks, as a car out is Rented (find-a-car.md, decision 5).
   */
  function markAvailable(vehicleId: string): Promise<unknown> {
    return superuser.db.execute(
      sql`update vehicles set status = 'available' where id = ${vehicleId}`,
    );
  }

  it("refuses to start into a car still out past its return date with someone else", async () => {
    const out = await kit.rentalOut(new Date(Date.now() - 24 * HOUR_MS));
    const late = await addCarOut(web, superuser, actor);
    await markAvailable(late.vehicleId);

    const result = await startSwap(
      web.db,
      actor,
      out.rentalId,
      { toVehicleId: late.vehicleId, reason: "Flat tyre" },
      clock(),
    );

    expect(result).toMatchObject({
      status: "clash",
      clash: { kind: "still_out", rentalId: late.lateRentalId },
    });
  });

  /**
   * A swap into a car booked by another rental in the past, started while that
   * car was still free; the other rental then goes out and is already late.
   */
  async function swapIntoCarThatGoesOutLate() {
    const out = await kit.rentalOut(new Date(Date.now() - 48 * HOUR_MS));
    const other = await addCarOut(web, superuser, actor, { isHandedOver: false });
    const started = await startSwap(
      web.db,
      actor,
      out.rentalId,
      { toVehicleId: other.vehicleId, reason: "Engine light on" },
      clock(),
    );
    expect(started.status).toBe("started");
    await recordTestHandover(superuser, other.lateRentalId, LATE_HANDED_OVER);
    await markAvailable(other.vehicleId);
    return { ...out, newCarId: other.vehicleId, swapId: "swapId" in started ? started.swapId : "" };
  }

  it("keeps nothing if the new car is out late with someone else by the time the swap is signed", async () => {
    const { rentalId, vehicleId, newCarId, swapId } = await swapIntoCarThatGoesOutLate();
    const [swap] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select().from(carSwaps).where(eq(carSwaps.id, swapId)),
    );
    await kit.fillChecklist(swap!.returnInspectionId, OLD_CAR_KM);
    await kit.fillChecklist(swap!.handoverInspectionId, NEW_CAR_KM);

    // Possession moves before the hold, so the possessions rule refuses first (rule 15).
    await expect(
      completeSwap(kit.handoverDeps(), actor, rentalId, await swapInput(rentalId), clock()),
    ).rejects.toThrow();

    const [rental] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select({ vehicleId: rentals.vehicleId }).from(rentals).where(eq(rentals.id, rentalId)),
    );
    const newCarHolds = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ id: carHolds.id })
        .from(carHolds)
        .where(and(eq(carHolds.rentalId, rentalId), eq(carHolds.vehicleId, newCarId))),
    );
    expect(rental?.vehicleId).toBe(vehicleId);
    expect(newCarHolds).toEqual([]);
  });

  it("refuses the new car's hold in the database if it is out late with someone else", async () => {
    const { rentalId, newCarId } = await swapIntoCarThatGoesOutLate();

    // The hold the swap's last step writes (moveHold), written on its own.
    const held = withTenant(web.db, actor.operatorId, (tx) =>
      tx.insert(carHolds).values({
        operatorId: actor.operatorId,
        vehicleId: newCarId,
        rentalId,
        heldDuring: heldRange(new Date(), null),
      }),
    );

    await expect(held).rejects.toSatisfy(isCarAlreadyHeld);
  });

  it("refuses to finish until both checklists are done, and a cancelled swap leaves the car out", async () => {
    const { rentalId, vehicleId, swap } = await swapUnderWayFor();

    const early = await completeSwap(
      kit.handoverDeps(),
      actor,
      rentalId,
      await swapInput(rentalId),
      clock(),
    );
    expect(early).toMatchObject({ status: "gaps", car: "old" });
    // The rental's own return waits while the swap is under way.
    expect((await startReturn(web.db, actor, rentalId)).status).toBe("not_booked");

    expect(await cancelSwap(web.db, actor, rentalId)).toBe("cancelled");
    const [rental] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select().from(rentals).where(eq(rentals.id, rentalId)),
    );
    const checklists = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ status: inspections.status })
        .from(inspections)
        .where(eq(inspections.id, swap.returnInspectionId)),
    );
    expect(rental?.vehicleId).toBe(vehicleId);
    expect(checklists).toEqual([{ status: "cancelled" }]);
    expect(await cancelSwap(web.db, actor, rentalId)).toBe("not_found");
  });

  it("signs only the swap, checklists and swap form the Renter was shown (review A6-11, G9-1)", async () => {
    const { rentalId, swap } = await swapUnderWayFor();
    await kit.fillChecklist(swap.returnInspectionId, OLD_CAR_KM);
    await kit.fillChecklist(swap.handoverInspectionId, NEW_CAR_KM);
    const asShown = await swapInput(rentalId);
    const finish = (shown: Partial<CompleteSwapInput["shown"]>) =>
      completeSwap(
        kit.handoverDeps(),
        actor,
        rentalId,
        { ...asShown, shown: { ...asShown.shown, ...shown } },
        clock(),
      );

    expect(await finish({ swapId: randomUUID() })).toEqual({ status: "changed" });
    expect(await finish({ returnFingerprint: "0".repeat(64) })).toEqual({ status: "changed" });
    expect(await finish({ swapTemplateVersionId: randomUUID() })).toEqual({
      status: "form_changed",
    });
    // The same template, but a filled-in form other than the one read (review G9-1).
    expect(await finish({ swapFormFingerprint: "e".repeat(64) })).toEqual({
      status: "form_changed",
    });
    expect((await finish({})).status).toBe("completed");
  });

  it("writes who had which car, and when, into the history (review A6-12, G9-8)", async () => {
    const { rentalId, swap } = await swapUnderWayFor();
    await kit.fillChecklist(swap.returnInspectionId, OLD_CAR_KM);
    await kit.fillChecklist(swap.handoverInspectionId, NEW_CAR_KM);
    const before = new Date();

    await completeSwap(kit.handoverDeps(), actor, rentalId, await swapInput(rentalId), clock());
    const lines = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ entityType: activityLog.entityType, action: activityLog.action })
        .from(activityLog)
        .where(
          and(eq(activityLog.operatorId, actor.operatorId), gte(activityLog.occurredAt, before)),
        ),
    );
    const said = lines.map((line) => `${line.entityType} ${line.action}`);

    expect(said).toEqual(
      expect.arrayContaining([
        "possession ended",
        "possession started",
        "car_hold released",
        "car_hold created",
      ]),
    );
  });

  it("swaps: three documents, possession and holds moved at one moment, cars and rental moved", async () => {
    const { rentalId, vehicleId, newCarId, swap } = await swapUnderWayFor();
    await kit.fillChecklist(swap.returnInspectionId, OLD_CAR_KM);
    await addDamageMark(web.db, actor, swap.returnInspectionId, {
      x: 500,
      y: 240,
      description: "Bonnet dent",
    });
    const marks = (await loadReturn(web.db, actor.operatorId, swap.returnInspectionId))!
      .damageMarks;
    await kit.takePhoto(swap.returnInspectionId, { damageMarkId: marks[0]!.id });
    await kit.fillChecklist(swap.handoverInspectionId, NEW_CAR_KM);
    sentEmails.length = 0;

    const result = await completeSwap(
      kit.handoverDeps(),
      actor,
      rentalId,
      await swapInput(rentalId),
      clock(),
    );
    expect(result.status).toBe("completed");
    expect(
      await completeSwap(kit.handoverDeps(), actor, rentalId, await swapInput(rentalId), clock()),
    ).toEqual({
      status: "not_found",
    });

    await withTenant(web.db, actor.operatorId, async (tx) => {
      const [rental] = await tx.select().from(rentals).where(eq(rentals.id, rentalId));
      const held = await tx
        .select({
          vehicleId: possessions.vehicleId,
          startedAt: possessions.startedAt,
          endedAt: possessions.endedAt,
        })
        .from(possessions)
        .where(eq(possessions.rentalId, rentalId))
        .orderBy(asc(possessions.startedAt));
      const liveHolds = await tx
        .select({ vehicleId: carHolds.vehicleId })
        .from(carHolds)
        .where(and(eq(carHolds.rentalId, rentalId), isNull(carHolds.releasedAt)));
      const cars = await tx
        .select({ id: vehicles.id, status: vehicles.status })
        .from(vehicles)
        .where(eq(vehicles.operatorId, actor.operatorId));
      const documents = await tx
        .select({ kind: issuedDocuments.kind })
        .from(issuedDocuments)
        .where(eq(issuedDocuments.rentalId, rentalId));
      expect(rental).toMatchObject({ vehicleId: newCarId, status: "active" });
      expect(held.map((row) => row.vehicleId)).toEqual([vehicleId, newCarId]);
      expect(held[0]?.endedAt).toEqual(held[1]?.startedAt);
      expect(held[1]?.endedAt).toBeNull();
      expect(liveHolds).toEqual([{ vehicleId: newCarId }]);
      expect(cars.find((car) => car.id === vehicleId)?.status).toBe("in_service");
      expect(cars.find((car) => car.id === newCarId)?.status).toBe("rented");
      expect(documents.map((document) => document.kind).sort()).toEqual([
        "contract",
        "handover_report",
        "handover_report",
        // The first week's invoice, issued with the handover.
        "invoice",
        "return_report",
        "swap_form",
      ]);
    });
    expect(sentEmails.map((email) => email.subject)).toEqual([
      expect.stringMatching(/^Your car swap with /),
      expect.stringMatching(/^Your car return report from /),
      expect.stringMatching(/^Your car handover report from /),
    ]);

    // The new car comes back later through the rental's own return, compared with the swap's handover.
    const started = await startReturn(web.db, actor, rentalId);
    const returnId = "inspectionId" in started ? started.inspectionId : "";
    const finalReturn = await loadReturn(web.db, actor.operatorId, returnId);
    expect(finalReturn?.vehicleId).toBe(newCarId);
    await kit.fillChecklist(returnId, NEW_CAR_KM + 300);
    const returned = await completeReturn(
      kit.handoverDeps(),
      actor,
      returnId,
      {
        shownFingerprint: await kit.shown(returnId),
        returnedAt: new Date(),
        signature: drawnSignatureInput(TEST_SIGNATURE),
        carAfter: { status: "available", statusReason: null, statusExpectedBack: null },
      },
      clock(),
    );
    expect(returned.status).toBe("completed");
  });

  it("keeps each business's swaps to itself", async () => {
    const { rentalId } = await swapUnderWayFor();

    expect(await cancelSwap(web.db, otherOperator, rentalId)).toBe("not_found");
    expect(
      await completeSwap(
        kit.handoverDeps(),
        otherOperator,
        rentalId,
        await swapInput(rentalId),
        clock(),
      ),
    ).toEqual({ status: "not_found" });
    expect(await cancelSwap(web.db, actor, rentalId)).toBe("cancelled");
  });
});
