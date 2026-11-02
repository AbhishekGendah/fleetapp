import { randomUUID } from "node:crypto";

import { DEFAULT_HANDOVER_PHOTOS } from "@fleetapp/core";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import * as schema from "../src/schema";
import { withTenant } from "../src/tenant-context";
import {
  addTestCar,
  addTestRenter,
  connectAs,
  POSTGRES_ERROR_CODES,
  postgresErrorCodeOf,
  seedTwoOperators,
  testRentalRow,
  type TestConnection,
} from "./fixtures";

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const EXCLUSION_VIOLATION = "23P01";
const HOUR_MS = 60 * 60 * 1000;

/**
 * Handover checklists, their damage marks and photos, and possessions: one
 * checklist under way per rental, fixed once finished, its photos kept,
 * one Renter per car at a time, all kept to their Operator.
 */
describe("inspections and possessions", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let superuser: TestConnection;
  let operatorAId: string;
  let operatorBId: string;
  let userAId: string;
  let renterId: string;

  async function addRental(vehicleId?: string) {
    const carId = vehicleId ?? (await addTestCar(web.db, operatorAId));
    const [rental] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.rentals)
        .values(testRentalRow({ operatorId: operatorAId, renterId, vehicleId: carId }))
        .returning({ id: schema.rentals.id }),
    );
    return { rentalId: rental!.id, vehicleId: carId };
  }

  async function startInspection(rental: { rentalId: string; vehicleId: string }) {
    const [inspection] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.inspections)
        .values({
          operatorId: operatorAId,
          ...rental,
          kind: "handover",
          photoNames: [...DEFAULT_HANDOVER_PHOTOS],
          startedByUserId: userAId,
        })
        .returning({ id: schema.inspections.id }),
    );
    return inspection!.id;
  }

  function complete(inspectionId: string) {
    return withTenant(web.db, operatorAId, (tx) =>
      tx
        .update(schema.inspections)
        .set({
          status: "completed",
          odometerKm: 1200,
          fuelLevel: "full",
          keysCount: 2,
          acceptanceText: "I received this car.",
          completedAt: new Date(),
        })
        .where(eq(schema.inspections.id, inspectionId)),
    );
  }

  function addPhoto(vehicleId: string, inspectionId: string, name: string) {
    return withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.files)
        .values({
          operatorId: operatorAId,
          purpose: "vehicle_photo",
          storageArea: "general",
          objectKey: `test/${randomUUID()}`,
          contentType: "image/jpeg",
          sizeBytes: 1000,
          vehicleId,
          label: `TEST ${randomUUID()}`,
          inspectionId,
          inspectionPhotoName: name,
          confirmedAt: new Date(),
        })
        .returning({ id: schema.files.id }),
    );
  }

  function addPossession(
    rental: { rentalId: string; vehicleId: string },
    inspectionId: string,
    startedAt: Date,
    endedAt: Date | null = null,
  ) {
    return withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.possessions)
        .values({
          operatorId: operatorAId,
          ...rental,
          renterId,
          startedAt,
          endedAt,
          handoverInspectionId: inspectionId,
        })
        .returning({ id: schema.possessions.id }),
    );
  }

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    superuser = connectAs(inject("superuserUrl"));
    ({ operatorAId, operatorBId } = await seedTwoOperators(admin.db));
    const [user] = await admin.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.operatorId, operatorAId));
    userAId = user!.id;
    renterId = await addTestRenter(web.db, operatorAId);
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close(), superuser.close()]);
  });

  it("keeps one checklist under way per rental, and needs the details before it completes", async () => {
    const rental = await addRental();
    const inspectionId = await startInspection(rental);

    const second = await postgresErrorCodeOf(startInspection(rental));
    const withoutDetails = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx
          .update(schema.inspections)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(schema.inspections.id, inspectionId)),
      ),
    );

    expect([second, withoutDetails]).toEqual([UNIQUE_VIOLATION, CHECK_VIOLATION]);
  });

  it("fixes a finished checklist, its damage marks and its photos", async () => {
    const rental = await addRental();
    const inspectionId = await startInspection(rental);
    const [photo] = await addPhoto(rental.vehicleId, inspectionId, "Front");
    const [mark] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.inspectionDamageMarks)
        .values({ operatorId: operatorAId, inspectionId, x: 100, y: 200, description: "Scratch" })
        .returning({ id: schema.inspectionDamageMarks.id }),
    );
    await complete(inspectionId);

    const codes = [
      await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) =>
          tx
            .update(schema.inspections)
            .set({ notes: "Changed later" })
            .where(eq(schema.inspections.id, inspectionId)),
        ),
      ),
      await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) =>
          tx
            .update(schema.inspectionDamageMarks)
            .set({ removedAt: new Date() })
            .where(eq(schema.inspectionDamageMarks.id, mark!.id)),
        ),
      ),
      await postgresErrorCodeOf(addPhoto(rental.vehicleId, inspectionId, "Rear")),
      await postgresErrorCodeOf(
        superuser.db
          .update(schema.files)
          .set({ deletedAt: new Date() })
          .where(eq(schema.files.id, photo!.id)),
      ),
      await postgresErrorCodeOf(
        superuser.db.delete(schema.inspections).where(eq(schema.inspections.id, inspectionId)),
      ),
    ];

    expect(codes).toEqual(codes.map(() => POSTGRES_ERROR_CODES.restrictViolation));
  });

  it("takes one photo in use for each name on the list", async () => {
    const rental = await addRental();
    const inspectionId = await startInspection(rental);
    await addPhoto(rental.vehicleId, inspectionId, "Front");

    expect(await postgresErrorCodeOf(addPhoto(rental.vehicleId, inspectionId, "Front"))).toBe(
      UNIQUE_VIOLATION,
    );
  });

  it("never lets two possessions of one car overlap, and ends a possession only once", async () => {
    const first = await addRental();
    const second = await addRental(first.vehicleId);
    const [handoverA, handoverB] = [await startInspection(first), await startInspection(second)];
    const start = new Date(Date.UTC(2027, 0, 1));
    const [open] = await addPossession(first, handoverA, start);

    const overlap = await postgresErrorCodeOf(
      addPossession(second, handoverB, new Date(start.getTime() + HOUR_MS)),
    );
    const end = new Date(start.getTime() + 24 * HOUR_MS);
    await withTenant(web.db, operatorAId, (tx) =>
      tx
        .update(schema.possessions)
        .set({ endedAt: end })
        .where(eq(schema.possessions.id, open!.id)),
    );
    const afterwards = await addPossession(second, handoverB, end);
    const endAgain = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx
          .update(schema.possessions)
          .set({ endedAt: new Date(end.getTime() + HOUR_MS) })
          .where(eq(schema.possessions.id, open!.id)),
      ),
    );

    expect(overlap).toBe(EXCLUSION_VIOLATION);
    expect(afterwards).toHaveLength(1);
    expect(endAgain).toBe(POSTGRES_ERROR_CODES.restrictViolation);
  });

  it("keeps checklists and possessions from other Operators and the admin app", async () => {
    const rental = await addRental();
    const inspectionId = await startInspection(rental);
    await addPossession(rental, inspectionId, new Date(Date.UTC(2028, 0, 1)));

    const seenByB = await withTenant(web.db, operatorBId, async (tx) => [
      ...(await tx.select().from(schema.inspections)),
      ...(await tx.select().from(schema.possessions)),
      ...(await tx.select().from(schema.inspectionDamageMarks)),
    ]);
    const adminCodes = [
      await postgresErrorCodeOf(admin.db.select().from(schema.inspections)),
      await postgresErrorCodeOf(admin.db.select().from(schema.possessions)),
      await postgresErrorCodeOf(admin.db.select().from(schema.inspectionDamageMarks)),
    ];

    expect(seenByB).toEqual([]);
    expect(adminCodes).toEqual(adminCodes.map(() => POSTGRES_ERROR_CODES.insufficientPrivilege));
  });
});
