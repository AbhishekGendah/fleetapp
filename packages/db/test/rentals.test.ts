import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import * as schema from "../src/schema";
import { withTenant } from "../src/tenant-context";
import {
  addTestCar,
  connectAs,
  POSTGRES_ERROR_CODES,
  postgresErrorCodeOf,
  seedTwoOperators,
  type TestConnection,
} from "./fixtures";

const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";
const EXCLUSION_VIOLATION = "23P01";
const TUESDAY = 2;
const BOND_CENTS = 50_000;
const WEEKLY_RATE_CENTS = 35_000;

/** One week of a car, written the way Postgres writes a time range: start included, end not. */
function heldFrom(start: string, end: string | null): string {
  return `[${start},${end ?? ""})`;
}

/**
 * Rentals, their rates and car holds (rules 1, 2, 14 and 18): kept to their
 * Operator, no car booked twice at once, steps followed in order, and the
 * settings and rates a rental was made with kept as they were.
 */
describe("rentals", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let superuser: TestConnection;
  let operatorAId: string;
  let operatorBId: string;
  let renterAId: string;
  let renterBId: string;
  let carAId: string;
  let carBId: string;

  async function addRenter(operatorId: string): Promise<string> {
    const [renter] = await withTenant(web.db, operatorId, (tx) =>
      tx
        .insert(schema.renters)
        .values({ operatorId, fullName: "Sam Example", email: "sam@example.test" })
        .returning({ id: schema.renters.id }),
    );
    return renter!.id;
  }

  function rentalRow(
    operatorId: string,
    changes: Partial<typeof schema.rentals.$inferInsert> = {},
  ): typeof schema.rentals.$inferInsert {
    return {
      operatorId,
      renterId: operatorId === operatorAId ? renterAId : renterBId,
      vehicleId: operatorId === operatorAId ? carAId : carBId,
      type: "fixed_term",
      status: "booked",
      plannedStart: new Date("2026-12-01T01:00:00Z"),
      plannedEnd: new Date("2026-12-29T01:00:00Z"),
      chargeWeekday: TUESDAY,
      bondCents: BOND_CENTS,
      settingsSnapshot: { minimumRenterAgeYears: 21 },
      settingsVersion: 1,
      ...changes,
    };
  }

  async function addRental(
    operatorId: string,
    changes: Partial<typeof schema.rentals.$inferInsert> = {},
  ): Promise<string> {
    const [rental] = await withTenant(web.db, operatorId, (tx) =>
      tx
        .insert(schema.rentals)
        .values(rentalRow(operatorId, changes))
        .returning({ id: schema.rentals.id }),
    );
    return rental!.id;
  }

  function holdCar(operatorId: string, vehicleId: string, rentalId: string, heldDuring: string) {
    return withTenant(web.db, operatorId, (tx) =>
      tx
        .insert(schema.carHolds)
        .values({ operatorId, vehicleId, rentalId, heldDuring })
        .returning({ id: schema.carHolds.id }),
    );
  }

  function moveRental(
    rentalId: string,
    changes: Partial<typeof schema.rentals.$inferInsert>,
  ): Promise<unknown> {
    return withTenant(web.db, operatorAId, (tx) =>
      tx.update(schema.rentals).set(changes).where(eq(schema.rentals.id, rentalId)),
    );
  }

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    superuser = connectAs(inject("superuserUrl"));
    ({ operatorAId, operatorBId } = await seedTwoOperators(admin.db));
    [renterAId, renterBId, carAId, carBId] = await Promise.all([
      addRenter(operatorAId),
      addRenter(operatorBId),
      addTestCar(web.db, operatorAId),
      addTestCar(web.db, operatorBId),
    ]);
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close(), superuser.close()]);
  });

  describe("kept to their Operator", () => {
    it("hides another Operator's rentals, rates and holds", async () => {
      const rentalBId = await addRental(operatorBId);
      await withTenant(web.db, operatorBId, (tx) =>
        tx.insert(schema.rentalRates).values({
          operatorId: operatorBId,
          rentalId: rentalBId,
          weeklyRateCents: WEEKLY_RATE_CENTS,
          appliesFrom: "2026-12-01",
        }),
      );
      await holdCar(
        operatorBId,
        carBId,
        rentalBId,
        heldFrom("2026-12-01T01:00:00Z", "2026-12-29T01:00:00Z"),
      );

      const seenByA = await withTenant(web.db, operatorAId, async (tx) => ({
        rentals: await tx.select().from(schema.rentals).where(eq(schema.rentals.id, rentalBId)),
        rates: await tx
          .select()
          .from(schema.rentalRates)
          .where(eq(schema.rentalRates.rentalId, rentalBId)),
        holds: await tx
          .select()
          .from(schema.carHolds)
          .where(eq(schema.carHolds.rentalId, rentalBId)),
      }));

      expect(seenByA).toEqual({ rentals: [], rates: [], holds: [] });
    });

    it("refuses a rental written for another Operator", async () => {
      const code = await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) =>
          tx.insert(schema.rentals).values(rentalRow(operatorBId)),
        ),
      );

      expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
    });

    it("refuses a rental of another Operator's car or Renter", async () => {
      const otherCar = postgresErrorCodeOf(addRental(operatorAId, { vehicleId: carBId }));
      const otherRenter = postgresErrorCodeOf(addRental(operatorAId, { renterId: renterBId }));

      expect(await Promise.all([otherCar, otherRenter])).toEqual([
        FOREIGN_KEY_VIOLATION,
        FOREIGN_KEY_VIOLATION,
      ]);
    });

    it("gives the admin app nothing on rentals", async () => {
      const code = await postgresErrorCodeOf(admin.db.select().from(schema.rentals));

      expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
    });
  });

  describe("no car booked twice at once", () => {
    it("refuses a hold that overlaps another on the same car", async () => {
      const car = await addTestCar(web.db, operatorAId);
      const first = await addRental(operatorAId, { vehicleId: car });
      const second = await addRental(operatorAId, { vehicleId: car });
      await holdCar(
        operatorAId,
        car,
        first,
        heldFrom("2026-12-01T01:00:00Z", "2026-12-08T01:00:00Z"),
      );

      const code = await postgresErrorCodeOf(
        holdCar(operatorAId, car, second, heldFrom("2026-12-07T01:00:00Z", "2026-12-14T01:00:00Z")),
      );

      expect(code).toBe(EXCLUSION_VIOLATION);
    });

    it("lets one booking start exactly as the last one ends", async () => {
      const car = await addTestCar(web.db, operatorAId);
      const first = await addRental(operatorAId, { vehicleId: car });
      const second = await addRental(operatorAId, { vehicleId: car });
      await holdCar(
        operatorAId,
        car,
        first,
        heldFrom("2026-12-01T01:00:00Z", "2026-12-08T01:00:00Z"),
      );

      const held = await holdCar(
        operatorAId,
        car,
        second,
        heldFrom("2026-12-08T01:00:00Z", "2026-12-15T01:00:00Z"),
      );

      expect(held).toHaveLength(1);
    });

    it("keeps an ongoing rental's car from every later booking", async () => {
      const car = await addTestCar(web.db, operatorAId);
      const ongoing = await addRental(operatorAId, {
        vehicleId: car,
        type: "ongoing",
        plannedEnd: null,
      });
      const later = await addRental(operatorAId, { vehicleId: car });
      await holdCar(operatorAId, car, ongoing, heldFrom("2026-12-01T01:00:00Z", null));

      const code = await postgresErrorCodeOf(
        holdCar(operatorAId, car, later, heldFrom("2027-06-01T01:00:00Z", "2027-06-08T01:00:00Z")),
      );

      expect(code).toBe(EXCLUSION_VIOLATION);
    });

    it("frees the car once a hold is released", async () => {
      const car = await addTestCar(web.db, operatorAId);
      const cancelled = await addRental(operatorAId, { vehicleId: car });
      const next = await addRental(operatorAId, { vehicleId: car });
      const period = heldFrom("2026-12-01T01:00:00Z", "2026-12-08T01:00:00Z");
      await holdCar(operatorAId, car, cancelled, period);
      await withTenant(web.db, operatorAId, (tx) =>
        tx
          .update(schema.carHolds)
          .set({ releasedAt: new Date() })
          .where(and(eq(schema.carHolds.rentalId, cancelled), eq(schema.carHolds.vehicleId, car))),
      );

      const held = await holdCar(operatorAId, car, next, period);

      expect(held).toHaveLength(1);
    });

    it("lets two cars be held over the same time", async () => {
      const otherCar = await addTestCar(web.db, operatorAId);
      const firstCar = await addTestCar(web.db, operatorAId);
      const period = heldFrom("2026-12-01T01:00:00Z", "2026-12-08T01:00:00Z");
      await holdCar(
        operatorAId,
        firstCar,
        await addRental(operatorAId, { vehicleId: firstCar }),
        period,
      );

      const held = await holdCar(
        operatorAId,
        otherCar,
        await addRental(operatorAId, { vehicleId: otherCar }),
        period,
      );

      expect(held).toHaveLength(1);
    });

    it("refuses an empty or backwards hold", async () => {
      const rental = await addRental(operatorAId);

      const code = await postgresErrorCodeOf(
        holdCar(
          operatorAId,
          carAId,
          rental,
          heldFrom("2026-12-01T01:00:00Z", "2026-12-01T01:00:00Z"),
        ),
      );

      expect(code).toBe(CHECK_VIOLATION);
    });
  });

  describe("steps in order", () => {
    it("starts a rental only as a draft or a booking", async () => {
      const code = await postgresErrorCodeOf(
        addRental(operatorAId, { status: "active", handedOverAt: new Date() }),
      );

      expect(code).toBe(CHECK_VIOLATION);
    });

    it("lets a draft be booked, then handed over, returned and closed", async () => {
      const rental = await addRental(operatorAId, { status: "draft" });
      await moveRental(rental, { status: "booked" });
      await moveRental(rental, {
        status: "active",
        handedOverAt: new Date("2026-12-01T02:00:00Z"),
      });
      await moveRental(rental, {
        status: "returned",
        returnedAt: new Date("2026-12-29T02:00:00Z"),
      });
      await moveRental(rental, { status: "closed" });

      const [row] = await withTenant(web.db, operatorAId, (tx) =>
        tx
          .select({ status: schema.rentals.status })
          .from(schema.rentals)
          .where(eq(schema.rentals.id, rental)),
      );
      expect(row?.status).toBe("closed");
    });

    it("refuses a skipped step or going back", async () => {
      const rental = await addRental(operatorAId);
      const skipped = await postgresErrorCodeOf(
        moveRental(rental, {
          status: "returned",
          handedOverAt: new Date("2026-12-01T02:00:00Z"),
          returnedAt: new Date("2026-12-29T02:00:00Z"),
        }),
      );
      await moveRental(rental, {
        status: "cancelled",
        cancelledAt: new Date(),
        cancellationReason: "Renter changed plans",
      });
      const reopened = await postgresErrorCodeOf(
        moveRental(rental, { status: "booked", cancelledAt: null, cancellationReason: null }),
      );

      expect([skipped, reopened]).toEqual([CHECK_VIOLATION, CHECK_VIOLATION]);
    });

    it("needs a reason to cancel", async () => {
      const rental = await addRental(operatorAId);

      const code = await postgresErrorCodeOf(
        moveRental(rental, { status: "cancelled", cancelledAt: new Date() }),
      );

      expect(code).toBe(CHECK_VIOLATION);
    });

    it("needs an end date for a fixed-term rental, and none for an ongoing one", async () => {
      const fixedWithoutEnd = postgresErrorCodeOf(addRental(operatorAId, { plannedEnd: null }));
      const ongoingWithEnd = postgresErrorCodeOf(addRental(operatorAId, { type: "ongoing" }));

      expect(await Promise.all([fixedWithoutEnd, ongoingWithEnd])).toEqual([
        CHECK_VIOLATION,
        CHECK_VIOLATION,
      ]);
    });
  });

  describe("kept as made", () => {
    it("never lets the Operator app change a rental's copied settings", async () => {
      const rental = await addRental(operatorAId);

      const code = await postgresErrorCodeOf(
        moveRental(rental, { settingsSnapshot: { minimumRenterAgeYears: 18 } }),
      );

      expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
    });

    it("refuses a change to the copied settings even from the database's top login", async () => {
      const rental = await addRental(operatorAId);

      const code = await postgresErrorCodeOf(
        superuser.db
          .update(schema.rentals)
          .set({ settingsVersion: 2 })
          .where(eq(schema.rentals.id, rental)),
      );

      expect(code).toBe(POSTGRES_ERROR_CODES.restrictViolation);
    });

    it("adds rates but never changes or removes one", async () => {
      const rental = await addRental(operatorAId);
      await withTenant(web.db, operatorAId, (tx) =>
        tx.insert(schema.rentalRates).values({
          operatorId: operatorAId,
          rentalId: rental,
          weeklyRateCents: WEEKLY_RATE_CENTS,
          appliesFrom: "2026-12-01",
        }),
      );
      const forRental = eq(schema.rentalRates.rentalId, rental);

      const codes = await Promise.all([
        postgresErrorCodeOf(
          withTenant(web.db, operatorAId, (tx) =>
            tx.update(schema.rentalRates).set({ weeklyRateCents: 1 }).where(forRental),
          ),
        ),
        postgresErrorCodeOf(
          superuser.db.update(schema.rentalRates).set({ weeklyRateCents: 1 }).where(forRental),
        ),
        postgresErrorCodeOf(superuser.db.delete(schema.rentalRates).where(forRental)),
      ]);

      expect(codes).toEqual([
        POSTGRES_ERROR_CODES.insufficientPrivilege,
        POSTGRES_ERROR_CODES.restrictViolation,
        POSTGRES_ERROR_CODES.restrictViolation,
      ]);
    });
  });
});
