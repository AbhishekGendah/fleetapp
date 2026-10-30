import { eq } from "drizzle-orm";
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

const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";
const UNIQUE_VIOLATION = "23505";

/** Purchases, sales and costs stay within their Operator; admin sees none of them. */
describe("car purchases, sales and costs", () => {
  let web: TestConnection;
  let admin: TestConnection;
  let operatorAId: string;
  let operatorBId: string;
  let carBId: string;

  function purchaseRow(operatorId: string, vehicleId: string) {
    return {
      operatorId,
      vehicleId,
      purchasedOn: "2026-09-01",
      source: "dealer" as const,
      sellerName: "Example Motors",
      priceCents: 22_000_00,
      gstCents: 2_000_00,
    };
  }

  function saleRow(operatorId: string, vehicleId: string) {
    return {
      operatorId,
      vehicleId,
      soldAt: new Date("2026-10-30T06:15:00Z"),
      priceCents: 18_000_00,
      gstCents: 0,
      buyerName: "Test Buyer",
      buyerPhone: "0412 345 678",
      buyerAddress: "1 Test Street, Perth WA 6000",
    };
  }

  function costRow(operatorId: string, vehicleId: string) {
    return {
      operatorId,
      vehicleId,
      incurredOn: "2026-09-10",
      kind: "refurb" as const,
      description: "Detailing",
      costCents: 330_00,
      gstCents: 30_00,
    };
  }

  beforeAll(async () => {
    web = connectAs(inject("webRoleUrl"));
    admin = connectAs(inject("adminRoleUrl"));
    ({ operatorAId, operatorBId } = await seedTwoOperators(admin.db));
    carBId = await addTestCar(web.db, operatorBId);
    await withTenant(web.db, operatorBId, async (tx) => {
      await tx.insert(schema.vehiclePurchases).values(purchaseRow(operatorBId, carBId));
      await tx.insert(schema.vehicleSales).values(saleRow(operatorBId, carBId));
      await tx.insert(schema.vehicleCosts).values(costRow(operatorBId, carBId));
    });
  });

  afterAll(async () => {
    await Promise.all([web.close(), admin.close()]);
  });

  it("shows an Operator none of another Operator's purchases, sales or costs", async () => {
    const found = await withTenant(web.db, operatorAId, (tx) =>
      Promise.all([
        tx.select().from(schema.vehiclePurchases),
        tx.select().from(schema.vehicleSales),
        tx.select().from(schema.vehicleCosts),
      ]),
    );
    expect(found).toEqual([[], [], []]);
  });

  it("cannot record any of them against another Operator's car", async () => {
    const attempts = [
      () =>
        withTenant(web.db, operatorAId, (tx) =>
          tx.insert(schema.vehicleCosts).values(costRow(operatorAId, carBId)),
        ),
      () =>
        withTenant(web.db, operatorAId, (tx) =>
          tx.insert(schema.vehicleSales).values(saleRow(operatorAId, carBId)),
        ),
    ];
    for (const attempt of attempts) {
      expect(await postgresErrorCodeOf(attempt())).toBe(FOREIGN_KEY_VIOLATION);
    }
  });

  it("allows one purchase per car, and one sale that is not cancelled", async () => {
    const secondPurchase = await postgresErrorCodeOf(
      withTenant(web.db, operatorBId, (tx) =>
        tx.insert(schema.vehiclePurchases).values(purchaseRow(operatorBId, carBId)),
      ),
    );
    expect(secondPurchase).toBe(UNIQUE_VIOLATION);
    const secondSale = await postgresErrorCodeOf(
      withTenant(web.db, operatorBId, (tx) =>
        tx.insert(schema.vehicleSales).values(saleRow(operatorBId, carBId)),
      ),
    );
    expect(secondSale).toBe(UNIQUE_VIOLATION);

    // Once the first falls through, the car can be sold again.
    await withTenant(web.db, operatorBId, async (tx) => {
      await tx
        .update(schema.vehicleSales)
        .set({ cancelledAt: new Date() })
        .where(eq(schema.vehicleSales.vehicleId, carBId));
      await tx.insert(schema.vehicleSales).values(saleRow(operatorBId, carBId));
    });
  });

  it("refuses GST above a tenth, and any GST on a private purchase", async () => {
    const otherCarId = await addTestCar(web.db, operatorBId);
    const attempts = [
      () =>
        withTenant(web.db, operatorBId, (tx) =>
          tx
            .insert(schema.vehicleCosts)
            .values({ ...costRow(operatorBId, carBId), gstCents: 31_00 }),
        ),
      () =>
        withTenant(web.db, operatorBId, (tx) =>
          tx
            .insert(schema.vehiclePurchases)
            .values({ ...purchaseRow(operatorBId, otherCarId), source: "private" }),
        ),
    ];
    for (const attempt of attempts) {
      expect(await postgresErrorCodeOf(attempt())).toBe(CHECK_VIOLATION);
    }
  });

  it("never lets the Operator app delete them", async () => {
    for (const table of [schema.vehiclePurchases, schema.vehicleSales, schema.vehicleCosts]) {
      const code = await postgresErrorCodeOf(
        withTenant(web.db, operatorBId, (tx) => tx.delete(table)),
      );
      expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
    }
  });

  it("gives the admin app no access to buyers, sellers or costs", async () => {
    for (const table of [schema.vehiclePurchases, schema.vehicleSales, schema.vehicleCosts]) {
      const code = await postgresErrorCodeOf(admin.db.select().from(table));
      expect(code).toBe(POSTGRES_ERROR_CODES.insufficientPrivilege);
    }
  });
});
