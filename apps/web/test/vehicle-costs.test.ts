import { WITHHELD_VALUE } from "@fleetapp/core";
import { activityLog, odometerReadings, vehicles } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { connectAs, type TestConnection } from "@fleetapp/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import type { ActingUser } from "../src/lib/acting-user";
import {
  emptyPurchaseForm,
  emptySaleForm,
  parseCostForm,
  parsePurchaseForm,
  parseSaleForm,
  type CostInput,
  type PurchaseInput,
  type SaleInput,
} from "../src/lib/vehicles/cost-input";
import { loadCarCosts } from "../src/lib/vehicles/cost-queries";
import {
  addCost,
  archiveCost,
  cancelSale,
  savePurchase,
  saveSale,
} from "../src/lib/vehicles/cost-records";
import { addTestCar, seedOperatorWithUser } from "./car-fixtures";

const PERTH = "Australia/Perth";

const PURCHASE_FORM = {
  ...emptyPurchaseForm(),
  purchasedOn: "2026-09-01",
  source: "dealer",
  sellerName: "Example Motors",
  sellerPhone: "0412345678",
  kilometres: "48,210",
  priceCents: "22,000",
  gstCents: "2,000",
};

const SALE_FORM = {
  ...emptySaleForm(),
  soldAt: "2026-10-30T14:15",
  priceCents: "18,000",
  buyerName: "Test Buyer",
  buyerPhone: "0499 999 999",
  buyerAddress: "1 Test Street, Perth WA 6000",
  buyerLicenceNumber: "1234567",
  buyerLicenceState: "WA",
};

const COST_FORM = {
  incurredOn: "2026-09-10",
  kind: "refurb",
  description: "Detailing",
  costCents: "330",
  gstCents: "30",
};

function parsed<Output>(
  result: { success: true; data: Output } | { success: false; error: Error },
): Output {
  if (!result.success) {
    throw new Error(result.error.message);
  }
  return result.data;
}

const purchase = (changes: Partial<typeof PURCHASE_FORM> = {}): PurchaseInput =>
  parsed(parsePurchaseForm({ ...PURCHASE_FORM, ...changes }));
const sale = (changes: Partial<typeof SALE_FORM> = {}): SaleInput =>
  parsed(parseSaleForm({ ...SALE_FORM, ...changes }, PERTH));
const cost = (changes: Partial<typeof COST_FORM> = {}): CostInput =>
  parsed(parseCostForm({ ...COST_FORM, ...changes }));

describe("the purchase, sale and cost forms' rules", () => {
  it("turns typed dollars, phones and km into what is saved", () => {
    expect(purchase()).toMatchObject({
      priceCents: 22_000_00,
      gstCents: 2_000_00,
      kilometres: 48_210,
      sellerPhone: "0412 345 678",
      sellerAddress: null,
    });
  });

  it("ignores GST on a private purchase, whatever its hidden box held", () => {
    expect(purchase({ source: "private" }).gstCents).toBe(0);
  });

  it("keeps the handover time in UTC, typed on the Operator's clock", () => {
    expect(sale().soldAt.toISOString()).toBe("2026-10-30T06:15:00.000Z");
    expect(
      parseSaleForm({ ...SALE_FORM, soldAt: "2026-10-04T02:30" }, "Australia/Sydney").success,
    ).toBe(false);
  });

  it("needs the buyer's name, phone and address", () => {
    expect(
      parseSaleForm({ ...SALE_FORM, buyerName: "", buyerPhone: "", buyerAddress: "" }, PERTH)
        .success,
    ).toBe(false);
    expect(parseCostForm({ ...COST_FORM, kind: "", gstCents: "31" }).success).toBe(false);
  });
});

describe("a car's purchase, sale and costs", () => {
  let admin: TestConnection;
  let web: TestConnection;
  let actor: ActingUser;
  let otherActor: ActingUser;

  beforeAll(async () => {
    admin = connectAs(inject("adminAppRoleUrl"));
    web = connectAs(inject("webAppRoleUrl"));
    actor = await seedOperatorWithUser(admin, "Costs Pty Ltd");
    otherActor = await seedOperatorWithUser(admin, "Other Costs Pty Ltd");
  });

  afterAll(async () => {
    await Promise.all([admin.close(), web.close()]);
  });

  async function historyOf(entityId: string) {
    return withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select({
          action: activityLog.action,
          valuesBefore: activityLog.valuesBefore,
          valuesAfter: activityLog.valuesAfter,
        })
        .from(activityLog)
        .where(eq(activityLog.entityId, entityId))
        .orderBy(activityLog.occurredAt),
    );
  }

  it("records the purchase once, with its odometer as a reading dated the purchase day", async () => {
    const carId = await addTestCar(web, actor);
    expect(await savePurchase(web.db, actor, carId, purchase(), PERTH)).toBe("saved");
    expect(await savePurchase(web.db, actor, carId, purchase(), PERTH)).toBe("unchanged");

    expect(
      await savePurchase(web.db, actor, carId, purchase({ kilometres: "48,300" }), PERTH),
    ).toBe("saved");
    const readings = await withTenant(web.db, actor.operatorId, (tx) =>
      tx
        .select()
        .from(odometerReadings)
        .where(and(eq(odometerReadings.vehicleId, carId), eq(odometerReadings.source, "purchase"))),
    );
    expect(readings.map((row) => [row.kilometres, row.withdrawnAt === null])).toEqual(
      expect.arrayContaining([
        [48_210, false],
        [48_300, true],
      ]),
    );
    // Midnight on 1 Sep in Perth.
    expect(readings[0]!.recordedAt.toISOString()).toBe("2026-08-31T16:00:00.000Z");

    const costs = await loadCarCosts(web.db, actor.operatorId, carId);
    expect(costs.purchaseKilometres).toBe(48_300);
    expect(costs.purchase?.priceCents).toBe(22_000_00);
  });

  it("never writes a seller's or buyer's details into the history", async () => {
    const carId = await addTestCar(web, actor);
    await savePurchase(web.db, actor, carId, purchase(), PERTH);
    await savePurchase(web.db, actor, carId, purchase({ sellerPhone: "0400 000 000" }), PERTH);
    await saveSale(web.db, actor, carId, sale());
    const { purchase: saved, sale: sold } = await loadCarCosts(web.db, actor.operatorId, carId);

    const lines = [...(await historyOf(saved!.id)), ...(await historyOf(sold!.id))];
    const written = JSON.stringify(lines);
    for (const personal of [
      "Example Motors",
      "0412 345 678",
      "0400 000 000",
      "Test Buyer",
      "1234567",
    ]) {
      expect(written).not.toContain(personal);
    }
    expect(lines[1]).toMatchObject({
      action: "updated",
      valuesAfter: { sellerPhone: WITHHELD_VALUE },
    });
  });

  it("sets the car to Sold, and back to Available if the sale falls through", async () => {
    const carId = await addTestCar(web, actor);
    const statusOf = async () =>
      (
        await withTenant(web.db, actor.operatorId, (tx) =>
          tx.select({ status: vehicles.status }).from(vehicles).where(eq(vehicles.id, carId)),
        )
      )[0]!.status;

    expect(await saveSale(web.db, actor, carId, sale())).toBe("saved");
    expect(await statusOf()).toBe("sold");
    expect(await saveSale(web.db, actor, carId, sale({ transferLodgedOn: "2026-10-31" }))).toBe(
      "saved",
    );
    expect((await loadCarCosts(web.db, actor.operatorId, carId)).sale?.transferLodgedOn).toBe(
      "2026-10-31",
    );

    expect(await cancelSale(web.db, actor, carId)).toBe("cancelled");
    expect(await statusOf()).toBe("available");
    const afterCancel = await loadCarCosts(web.db, actor.operatorId, carId);
    expect(afterCancel.sale).toBeNull();
    expect(afterCancel.historyIds.saleIds).toHaveLength(1);
  });

  it("adds up costs, and takes a removed one out of the totals", async () => {
    const carId = await addTestCar(web, actor);
    await savePurchase(web.db, actor, carId, purchase({ source: "private" }), PERTH);
    await addCost(web.db, actor, carId, cost());
    await addCost(
      web.db,
      actor,
      carId,
      cost({ kind: "repair", costCents: "1,100", gstCents: "100" }),
    );
    await saveSale(web.db, actor, carId, sale({ priceCents: "27,500", gstCents: "2,500" }));

    const costs = await loadCarCosts(web.db, actor.operatorId, carId);
    // 25,000 - 22,000 - 300 - 1,000
    expect(costs.totals.differenceExcludingGstCents).toBe(1_700_00);

    expect(await archiveCost(web.db, actor, costs.costs[0]!.id)).toBe("archived");
    const after = await loadCarCosts(web.db, actor.operatorId, carId);
    expect(after.costs).toHaveLength(1);
    expect(after.historyIds.costIds).toHaveLength(2);
  });

  it("refuses another Operator's car and cost", async () => {
    const carId = await addTestCar(web, actor);
    await addCost(web.db, actor, carId, cost());
    const [costId] = (await loadCarCosts(web.db, actor.operatorId, carId)).costs.map((c) => c.id);

    expect(await savePurchase(web.db, otherActor, carId, purchase(), PERTH)).toBe("not_found");
    expect(await saveSale(web.db, otherActor, carId, sale())).toBe("not_found");
    expect(await addCost(web.db, otherActor, carId, cost())).toBe("not_found");
    expect(await archiveCost(web.db, otherActor, costId!)).toBe("not_found");
    expect((await loadCarCosts(web.db, otherActor.operatorId, carId)).costs).toEqual([]);
  });
});
