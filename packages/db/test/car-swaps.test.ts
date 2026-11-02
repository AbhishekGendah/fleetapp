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
const FOREIGN_KEY_VIOLATION = "23503";
const RESTRICT_VIOLATION = "23001";

/**
 * Car swaps: one under way per rental, a second handover and return for
 * each swap while the rental's own stay one each, the rental's car moved
 * only by its swap, finished swaps fixed, each business's own.
 */
describe("car swaps", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let operatorAId: string;
  let operatorBId: string;

  async function userOf(operatorId: string): Promise<string> {
    const [user] = await withTenant(web.db, operatorId, (tx) =>
      tx.select({ id: schema.users.id }).from(schema.users).limit(1),
    );
    return user!.id;
  }

  async function activeRental() {
    const [renterId, vehicleId] = await Promise.all([
      addTestRenter(web.db, operatorAId),
      addTestCar(web.db, operatorAId),
    ]);
    const [rental] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.rentals)
        .values(testRentalRow({ operatorId: operatorAId, renterId, vehicleId }))
        .returning({ id: schema.rentals.id }),
    );
    await withTenant(web.db, operatorAId, (tx) =>
      tx
        .update(schema.rentals)
        .set({ status: "active", handedOverAt: new Date("2026-12-01T01:00:00Z") })
        .where(eq(schema.rentals.id, rental!.id)),
    );
    return { rentalId: rental!.id, vehicleId };
  }

  async function addInspection(
    rental: { rentalId: string; vehicleId: string },
    kind: "handover" | "return",
    options: { isForSwap?: boolean; isCompleted?: boolean } = {},
  ): Promise<string> {
    const startedByUserId = await userOf(operatorAId);
    const finished = options.isCompleted
      ? {
          status: "completed" as const,
          odometerKm: 1200,
          fuelLevel: "full" as const,
          keysCount: 2,
          acceptanceText: "Accepted.",
          completedAt: new Date(),
        }
      : {};
    const [inspection] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.inspections)
        .values({
          operatorId: operatorAId,
          ...rental,
          kind,
          photoNames: [...DEFAULT_HANDOVER_PHOTOS],
          startedByUserId,
          isForSwap: options.isForSwap ?? false,
          ...finished,
        })
        .returning({ id: schema.inspections.id }),
    );
    return inspection!.id;
  }

  async function startSwap(
    rental: { rentalId: string; vehicleId: string },
    toVehicleId: string,
  ): Promise<string> {
    const returnInspectionId = await addInspection(rental, "return", { isForSwap: true });
    const handoverInspectionId = await addInspection(
      { rentalId: rental.rentalId, vehicleId: toVehicleId },
      "handover",
      { isForSwap: true },
    );
    const startedByUserId = await userOf(operatorAId);
    const [swap] = await withTenant(web.db, operatorAId, (tx) =>
      tx
        .insert(schema.carSwaps)
        .values({
          operatorId: operatorAId,
          rentalId: rental.rentalId,
          fromVehicleId: rental.vehicleId,
          toVehicleId,
          reason: "Breakdown",
          returnInspectionId,
          handoverInspectionId,
          startedByUserId,
        })
        .returning({ id: schema.carSwaps.id }),
    );
    return swap!.id;
  }

  function moveRentalTo(rentalId: string, vehicleId: string) {
    return withTenant(web.db, operatorAId, (tx) =>
      tx.update(schema.rentals).set({ vehicleId }).where(eq(schema.rentals.id, rentalId)),
    );
  }

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    ({ operatorAId, operatorBId } = await seedTwoOperators(admin.db));
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close()]);
  });

  it("keeps the rental's own handover and return one each, while swaps add their own", async () => {
    const rental = await activeRental();
    await addInspection(rental, "handover", { isCompleted: true });

    const secondOwn = await postgresErrorCodeOf(
      addInspection(rental, "handover", { isCompleted: true }),
    );
    await addInspection(rental, "handover", { isCompleted: true, isForSwap: true });
    await addInspection(rental, "return", { isCompleted: true, isForSwap: true });

    expect(secondOwn).toBe(UNIQUE_VIOLATION);
  });

  it("moves the rental's car only through its swap under way, to that swap's car", async () => {
    const rental = await activeRental();
    const newCar = await addTestCar(web.db, operatorAId);
    const otherCar = await addTestCar(web.db, operatorAId);

    const withoutSwap = await postgresErrorCodeOf(moveRentalTo(rental.rentalId, newCar));
    await startSwap(rental, newCar);
    const toAnotherCar = await postgresErrorCodeOf(moveRentalTo(rental.rentalId, otherCar));
    await moveRentalTo(rental.rentalId, newCar);
    const second = await postgresErrorCodeOf(startSwap(rental, otherCar));

    expect([withoutSwap, toAnotherCar]).toEqual([CHECK_VIOLATION, CHECK_VIOLATION]);
    expect(second).toBe(UNIQUE_VIOLATION);
  });

  it("needs another car, a reason, and the signed form to be finished; then it is fixed", async () => {
    const otherRental = await activeRental();
    const sameCar = await postgresErrorCodeOf(startSwap(otherRental, otherRental.vehicleId));
    const rental = await activeRental();
    const swapId = await startSwap(rental, await addTestCar(web.db, operatorAId));

    const finishedUnsigned = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx
          .update(schema.carSwaps)
          .set({ status: "completed", swappedAt: new Date(), fromVehicleStatusAfter: "available" })
          .where(eq(schema.carSwaps.id, swapId)),
      ),
    );
    await withTenant(web.db, operatorAId, (tx) =>
      tx
        .update(schema.carSwaps)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(eq(schema.carSwaps.id, swapId)),
    );
    const reopened = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx
          .update(schema.carSwaps)
          .set({ status: "in_progress", cancelledAt: null })
          .where(eq(schema.carSwaps.id, swapId)),
      ),
    );
    const deleted = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx.delete(schema.carSwaps).where(eq(schema.carSwaps.id, swapId)),
      ),
    );

    expect([sameCar, finishedUnsigned]).toEqual([CHECK_VIOLATION, CHECK_VIOLATION]);
    expect(reopened).toBe(RESTRICT_VIOLATION);
    expect(deleted).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("keeps swaps from other Operators and the admin app", async () => {
    const rental = await activeRental();
    await startSwap(rental, await addTestCar(web.db, operatorAId));

    const seenByB = await withTenant(web.db, operatorBId, (tx) =>
      tx.select().from(schema.carSwaps),
    );
    const bUser = await userOf(operatorBId);
    const onOthersRental = await postgresErrorCodeOf(
      withTenant(web.db, operatorBId, async (tx) => {
        const [inspection] = await tx.select().from(schema.inspections).limit(1);
        return tx.insert(schema.carSwaps).values({
          operatorId: operatorBId,
          rentalId: rental.rentalId,
          fromVehicleId: rental.vehicleId,
          toVehicleId: rental.vehicleId,
          reason: "x",
          returnInspectionId: inspection?.id ?? rental.rentalId,
          handoverInspectionId: inspection?.id ?? rental.rentalId,
          startedByUserId: bUser,
        });
      }),
    );
    const adminCode = await postgresErrorCodeOf(admin.db.select().from(schema.carSwaps));

    expect(seenByB).toEqual([]);
    expect([FOREIGN_KEY_VIOLATION, CHECK_VIOLATION]).toContain(onOthersRental);
    expect(adminCode).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });
});
