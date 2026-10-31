import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import * as schema from "../src/schema";
import { withTenant } from "../src/tenant-context";
import {
  connectAs,
  POSTGRES_ERROR_CODES,
  postgresErrorCodeOf,
  seedTwoOperators,
  type TestConnection,
} from "./fixtures";

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";

function carRow(operatorId: string, overrides: Partial<typeof schema.vehicles.$inferInsert> = {}) {
  return {
    operatorId,
    // Unique per call: test files share one database.
    rego: randomUUID().slice(0, 6).toUpperCase(),
    regoState: "WA" as const,
    make: "Toyota",
    model: "Camry",
    year: 2022,
    ...overrides,
  };
}

/** Cars and their odometer readings stay within their Operator; admin sees none of them. */
describe("vehicles", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let operatorAId: string;
  let operatorBId: string;
  let operatorBCarId: string;

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    ({ operatorAId, operatorBId } = await seedTwoOperators(admin.db));

    await withTenant(web.db, operatorAId, (tx) =>
      tx.insert(schema.vehicles).values(carRow(operatorAId)),
    );
    const [operatorBCar] = await withTenant(web.db, operatorBId, (tx) =>
      tx.insert(schema.vehicles).values(carRow(operatorBId)).returning({ id: schema.vehicles.id }),
    );
    operatorBCarId = operatorBCar!.id;
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close()]);
  });

  it("shows an Operator only its own cars", async () => {
    const rows = await withTenant(web.db, operatorAId, (tx) => tx.select().from(schema.vehicles));

    expect(rows.map((row) => row.operatorId)).toEqual([operatorAId]);
  });

  it("cannot add a car for another Operator", async () => {
    const code = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx.insert(schema.vehicles).values(carRow(operatorBId)),
      ),
    );

    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("cannot change or archive another Operator's car", async () => {
    await withTenant(web.db, operatorAId, (tx) =>
      tx
        .update(schema.vehicles)
        .set({ model: "Corolla", archivedAt: new Date() })
        .where(eq(schema.vehicles.id, operatorBCarId)),
    );

    const [car] = await withTenant(web.db, operatorBId, (tx) =>
      tx.select().from(schema.vehicles).where(eq(schema.vehicles.id, operatorBCarId)),
    );
    expect(car?.model).toBe("Camry");
    expect(car?.archivedAt).toBeNull();
  });

  it("cannot move a car to another Operator", async () => {
    const code = await postgresErrorCodeOf(
      withTenant(web.db, operatorBId, (tx) =>
        tx
          .update(schema.vehicles)
          .set({ operatorId: operatorAId })
          .where(eq(schema.vehicles.id, operatorBCarId)),
      ),
    );

    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("cannot delete a car", async () => {
    const code = await postgresErrorCodeOf(
      withTenant(web.db, operatorBId, (tx) =>
        tx.delete(schema.vehicles).where(eq(schema.vehicles.id, operatorBCarId)),
      ),
    );

    expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
  });

  it("refuses the same rego twice, but allows it again once the first car is archived", async () => {
    const first = carRow(operatorAId);
    const [saved] = await withTenant(web.db, operatorAId, (tx) =>
      tx.insert(schema.vehicles).values(first).returning({ id: schema.vehicles.id }),
    );

    const code = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx.insert(schema.vehicles).values(carRow(operatorAId, { rego: first.rego })),
      ),
    );
    expect(code).toBe(UNIQUE_VIOLATION);

    await withTenant(web.db, operatorAId, async (tx) => {
      await tx
        .update(schema.vehicles)
        .set({ archivedAt: new Date() })
        .where(eq(schema.vehicles.id, saved!.id));
      await tx.insert(schema.vehicles).values(carRow(operatorAId, { rego: first.rego }));
    });
  });

  it("allows the same rego at two different Operators", async () => {
    const rego = randomUUID().slice(0, 6).toUpperCase();
    await withTenant(web.db, operatorAId, (tx) =>
      tx.insert(schema.vehicles).values(carRow(operatorAId, { rego })),
    );
    await withTenant(web.db, operatorBId, (tx) =>
      tx.insert(schema.vehicles).values(carRow(operatorBId, { rego })),
    );
  });

  it("needs a reason and return date for in service, and only then", async () => {
    const missingReason = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx.insert(schema.vehicles).values(carRow(operatorAId, { status: "in_service" })),
      ),
    );
    expect(missingReason).toBe(CHECK_VIOLATION);

    const leftOver = await postgresErrorCodeOf(
      withTenant(web.db, operatorAId, (tx) =>
        tx
          .insert(schema.vehicles)
          .values(
            carRow(operatorAId, { statusReason: "Brakes", statusExpectedBack: "2026-11-01" }),
          ),
      ),
    );
    expect(leftOver).toBe(CHECK_VIOLATION);

    await withTenant(web.db, operatorAId, (tx) =>
      tx.insert(schema.vehicles).values(
        carRow(operatorAId, {
          status: "in_service",
          statusReason: "Brakes",
          statusExpectedBack: "2026-11-01",
        }),
      ),
    );
  });

  it("gives the admin app no access to cars or readings", async () => {
    for (const table of [schema.vehicles, schema.odometerReadings]) {
      const code = await postgresErrorCodeOf(admin.db.select().from(table));
      expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
    }
  });

  describe("odometer readings", () => {
    function readingRow(operatorId: string, vehicleId: string) {
      return {
        operatorId,
        vehicleId,
        kilometres: 12_000,
        recordedAt: new Date(),
        source: "manual" as const,
      };
    }

    it("cannot be added to another Operator's car, even under its own Operator", async () => {
      const code = await postgresErrorCodeOf(
        withTenant(web.db, operatorAId, (tx) =>
          tx.insert(schema.odometerReadings).values(readingRow(operatorAId, operatorBCarId)),
        ),
      );

      expect(code).toBe(FOREIGN_KEY_VIOLATION);
    });

    it("can be withdrawn but never changed or deleted", async () => {
      const [reading] = await withTenant(web.db, operatorBId, (tx) =>
        tx
          .insert(schema.odometerReadings)
          .values(readingRow(operatorBId, operatorBCarId))
          .returning({ id: schema.odometerReadings.id }),
      );
      const byId = eq(schema.odometerReadings.id, reading!.id);

      await withTenant(web.db, operatorBId, (tx) =>
        tx.update(schema.odometerReadings).set({ withdrawnAt: new Date() }).where(byId),
      );

      const changed = await postgresErrorCodeOf(
        withTenant(web.db, operatorBId, (tx) =>
          tx.update(schema.odometerReadings).set({ kilometres: 1 }).where(byId),
        ),
      );
      expect(changed).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);

      const deleted = await postgresErrorCodeOf(
        withTenant(web.db, operatorBId, (tx) => tx.delete(schema.odometerReadings).where(byId)),
      );
      expect(deleted).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
    });

    it("refuses an impossible reading", async () => {
      const code = await postgresErrorCodeOf(
        withTenant(web.db, operatorBId, (tx) =>
          tx
            .insert(schema.odometerReadings)
            .values({ ...readingRow(operatorBId, operatorBCarId), kilometres: -1 }),
        ),
      );

      expect(code).toBe(CHECK_VIOLATION);
    });
  });
});
