import { drawnSignatureInput } from "@fleetapp/core";
import { activityLog, carHolds, inspections, rentals, vehicles } from "@fleetapp/db/schema";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailMessage } from "@fleetapp/email";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import { loadPaperworkDue } from "../src/lib/dashboard/fleet-overview";
import { completeHandover } from "../src/lib/handover/complete-handover";
import { NO_OVERRIDE_REASONS, type OverrideReasons } from "../src/lib/handover/override-reasons";
import { cancelRental } from "../src/lib/rentals/rental-records";
import { archiveRenter, changeRenterStatus } from "../src/lib/renters/renter-records";
import {
  createMemoryFileStorage,
  type MemoryFileStorage,
} from "../src/lib/storage/memory-file-storage";
import { archiveVehicle } from "../src/lib/vehicles/vehicle-records";
import { seedOperatorWithUser } from "./car-fixtures";
import { checklistKit, TEST_SIGNATURE } from "./handover-fixtures";
import { addRenterReadyToRent, bookTestRentalOn, TEST_TIME_ZONE } from "./rental-fixtures";

/** Batch 7, slice A: what stops a car changing hands (review A6-1, A6-3, A6-9, A8-1, A8-2). */
describe("handover safety", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let storage: MemoryFileStorage;
  let actor: ActingUser;
  let kit: ReturnType<typeof checklistKit>;
  const sentEmails: EmailMessage[] = [];

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    storage = createMemoryFileStorage();
    actor = await seedOperatorWithUser(admin, "Handover Safety Rentals Pty Ltd");
    kit = checklistKit(web, storage, sentEmails, actor);
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  async function accept(inspectionId: string, now: Date, reasons: Partial<OverrideReasons> = {}) {
    return completeHandover(
      kit.handoverDeps(),
      actor,
      inspectionId,
      {
        ...NO_OVERRIDE_REASONS,
        ...reasons,
        shownFingerprint: await kit.shown(inspectionId),
        signature: drawnSignatureInput(TEST_SIGNATURE),
      },
      { timeZone: TEST_TIME_ZONE, now },
    );
  }

  async function carStatus(vehicleId: string) {
    const [car] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select({ status: vehicles.status }).from(vehicles).where(eq(vehicles.id, vehicleId)),
    );
    return car?.status;
  }

  /** A second booking of the same car, for a Renter with everything on file. */
  async function bookSameCar(
    vehicleId: string,
    period: { plannedStart: string; plannedEnd: string },
    now = new Date(),
  ) {
    const renterId = await addRenterReadyToRent(web, kit.deps(), actor, "Sam Second");
    return bookTestRentalOn(web, actor, { renterId, vehicleId, period, now });
  }

  it("blocks the handover once the Renter is marked Do not rent after booking", async () => {
    const booked = await kit.readyRental();
    const inspectionId = await kit.filledHandover(booked.rentalId);
    await changeRenterStatus(web.db, actor, booked.renterId, {
      status: "do_not_rent",
      doNotRentReason: "Unpaid tolls",
    });

    const result = await accept(inspectionId, new Date());

    expect(result.status).toBe("blocked");
    expect(result.status === "blocked" && result.problems.map((problem) => problem.code)).toEqual([
      "do_not_rent",
    ]);
    expect(await carStatus(booked.vehicleId)).toBe("available");
  });

  it("blocks the handover of a car written off after booking, and keeps it written off", async () => {
    const booked = await kit.readyRental();
    const inspectionId = await kit.filledHandover(booked.rentalId);
    await withTenant(web.db, actor.operatorId, (tx) =>
      tx.update(vehicles).set({ status: "written_off" }).where(eq(vehicles.id, booked.vehicleId)),
    );

    const result = await accept(inspectionId, new Date());

    expect(result.status).toBe("blocked");
    expect(await carStatus(booked.vehicleId)).toBe("written_off");
  });

  it("warns when booking a car whose Renter is overdue back, and blocks its handover until it is", async () => {
    const first = await kit.rentalOut(new Date("2027-05-31T01:00:00Z"));
    const afterFirstEnds = new Date("2027-06-30T01:00:00Z");
    const second = await bookSameCar(
      first.vehicleId,
      { plannedStart: "2027-07-01T09:00", plannedEnd: "2027-07-29T09:00" },
      afterFirstEnds,
    );
    await kit.signAndHoldBond(second.rentalId);
    const inspectionId = await kit.filledHandover(second.rentalId);

    const result = await accept(inspectionId, new Date("2027-07-01T02:00:00Z"));

    expect(second.problems.map((problem) => problem.code)).toContain("car_still_out");
    expect(result.status).toBe("blocked");
    expect(result.status === "blocked" && result.problems[0]?.code).toBe("car_still_out");
  });

  it("holds the car from an early handover, so the time before its start can't be booked", async () => {
    const out = await kit.rentalOut(new Date("2027-05-20T01:00:00Z"));
    const [hold] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ heldDuring: carHolds.heldDuring })
        .from(carHolds)
        .where(and(eq(carHolds.rentalId, out.rentalId), isNull(carHolds.releasedAt))),
    );

    await expect(
      bookSameCar(out.vehicleId, {
        plannedStart: "2027-05-24T09:00",
        plannedEnd: "2027-05-28T09:00",
      }),
    ).rejects.toThrow("car_taken");
    expect(String(hold?.heldDuring)).toContain("2027-05-20");
  });

  it("refuses an early handover that would take the car from a booking before it", async () => {
    const later = await kit.readyRental();
    const earlier = await bookSameCar(later.vehicleId, {
      plannedStart: "2027-05-10T09:00",
      plannedEnd: "2027-05-15T09:00",
    });
    const inspectionId = await kit.filledHandover(later.rentalId);

    const result = await accept(inspectionId, new Date("2027-05-12T01:00:00Z"));

    expect(result.status).toBe("early_clash");
    expect(result.status === "early_clash" && result.clash?.rentalId).toBe(earlier.rentalId);
    expect(await carStatus(later.vehicleId)).toBe("available");
  });

  it("cancels the open checklist with its booking, and says so to a phone still on it", async () => {
    const booked = await kit.readyRental();
    const inspectionId = await kit.filledHandover(booked.rentalId);

    await cancelRental(
      web.db,
      actor,
      booked.rentalId,
      { reason: "Renter changed plans" },
      new Date(),
    );
    const result = await accept(inspectionId, new Date());
    const [checklist] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ status: inspections.status })
        .from(inspections)
        .where(eq(inspections.id, inspectionId)),
    );

    expect(checklist?.status).toBe("cancelled");
    expect(result).toEqual({ status: "cancelled" });
  });

  it("never makes a cancelled booking active, even from a checklist left open (batch 7 review)", async () => {
    const booked = await kit.readyRental();
    const inspectionId = await kit.filledHandover(booked.rentalId);
    // As a booking cancelled before this release left its checklist open.
    await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .update(rentals)
        .set({ status: "cancelled", cancelledAt: new Date(), cancellationReason: "Old" })
        .where(eq(rentals.id, booked.rentalId)),
    );

    const result = await accept(inspectionId, new Date());
    const [rental] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select({ status: rentals.status }).from(rentals).where(eq(rentals.id, booked.rentalId)),
    );

    expect(result.status).not.toBe("completed");
    expect(rental?.status).toBe("cancelled");
  });

  it("asks why a car goes with no insurance or rego on file, and keeps the reasons off the Log", async () => {
    const booked = await kit.readyRental({ isPaperworkOnFile: false });
    const inspectionId = await kit.filledHandover(booked.rentalId);

    const withoutReasons = await accept(inspectionId, new Date());
    const insuranceOnly = await accept(inspectionId, new Date(), {
      insuranceOverrideReason: "Fleet policy, papers at the office",
    });
    const withReasons = await accept(inspectionId, new Date(), {
      insuranceOverrideReason: "Fleet policy, papers at the office",
      regoOverrideReason: "Renewed online this morning",
    });
    const [checklist] = await withTenant(web.db, actor.operatorId, (tx) =>
      tx.select().from(inspections).where(eq(inspections.id, inspectionId)),
    );
    const logged = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({ valuesAfter: activityLog.valuesAfter })
        .from(activityLog)
        .where(eq(activityLog.entityId, inspectionId)),
    );

    expect(withoutReasons).toEqual({ status: "reason_needed", problem: "no_insurance" });
    expect(insuranceOnly).toEqual({ status: "reason_needed", problem: "no_rego" });
    expect(withReasons.status).toBe("completed");
    expect(checklist?.insuranceOverrideReason).toBe("Fleet policy, papers at the office");
    expect(checklist?.regoOverrideReason).toBe("Renewed online this morning");
    expect(JSON.stringify(logged)).toContain("insuranceOverridden");
    expect(JSON.stringify(logged)).not.toContain("papers at the office");
  });

  it("lists a car with no insurance or rego on the dashboard", async () => {
    const booked = await kit.readyRental({ isPaperworkOnFile: false });

    const due = await loadPaperworkDue(web.db, actor.operatorId, {
      today: "2026-11-05",
      warningDays: 30,
    });
    const car = due.items.find((item) => item.id === booked.vehicleId);

    expect(car).toMatchObject({ isInsuredToday: false, isRegisteredToday: false });
  });

  it("refuses to archive a car or Renter while booked, and allows it once cancelled", async () => {
    const booked = await kit.readyRental();

    const carWhileBooked = await archiveVehicle(web.db, actor, booked.vehicleId);
    const renterWhileBooked = await archiveRenter(web.db, actor, booked.renterId);
    await cancelRental(web.db, actor, booked.rentalId, { reason: "Not going ahead" }, new Date());

    expect(carWhileBooked).toBe("in_use");
    expect(renterWhileBooked).toBe("in_use");
    expect(await archiveVehicle(web.db, actor, booked.vehicleId)).toBe("changed");
    expect(await archiveRenter(web.db, actor, booked.renterId)).toBe("changed");
  });
});
