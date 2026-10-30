import {
  changedValues,
  hasChanges,
  localDateTimeToUtc,
  withholdChangedFields,
  withholdFields,
  type VehicleStatus,
} from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  odometerReadings,
  vehicleCosts,
  vehiclePurchases,
  vehicleSales,
  vehicles,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, isNull } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import {
  PERSONAL_PURCHASE_FIELDS,
  PERSONAL_SALE_FIELDS,
  type CostInput,
  type PurchaseInput,
  type PurchaseRecord,
  type SaleInput,
} from "./cost-input";
import { findCurrentVehicle } from "./current-vehicle";
import { addReading, withdrawReading } from "./odometer";
import { applyVehicleStatus } from "./vehicle-records";

export type SaveRecordResult = "saved" | "unchanged" | "not_found";

const PURCHASE_RECORD_FIELDS = [
  "purchasedOn",
  "source",
  "sellerName",
  "sellerPhone",
  "sellerAddress",
  "priceCents",
  "gstCents",
] as const satisfies readonly (keyof PurchaseRecord)[];

const SALE_FIELDS = [
  "soldAt",
  "priceCents",
  "gstCents",
  "buyerName",
  "buyerPhone",
  "buyerAddress",
  "buyerLicenceNumber",
  "buyerLicenceState",
  "transferLodgedOn",
  "transferReference",
] as const satisfies readonly (keyof SaleInput)[];

/** The status a car takes when sold, and goes back to if the sale falls through. */
function statusOnly(status: VehicleStatus) {
  return { status, statusReason: null, statusExpectedBack: null };
}

/**
 * The odometer at purchase, as a reading dated the start of the purchase
 * day on the Operator's clock. A change withdraws the old reading (kept on
 * record) and adds the new one.
 */
async function syncPurchaseReading(
  tx: AnyTransaction,
  actor: ActingUser,
  vehicleId: string,
  wanted: { kilometres: number | null; purchasedOn: string },
  timeZone: string,
): Promise<boolean> {
  const [current] = await tx
    .select({
      id: odometerReadings.id,
      kilometres: odometerReadings.kilometres,
      recordedAt: odometerReadings.recordedAt,
    })
    .from(odometerReadings)
    .where(
      and(
        eq(odometerReadings.vehicleId, vehicleId),
        eq(odometerReadings.source, "purchase"),
        isNull(odometerReadings.withdrawnAt),
      ),
    );
  // Clocks in Australia change at 2 or 3 am, so midnight always exists.
  const recordedAt = localDateTimeToUtc(`${wanted.purchasedOn}T00:00`, timeZone)!;
  const isSame =
    current?.kilometres === wanted.kilometres &&
    current.recordedAt.getTime() === recordedAt.getTime();
  if (isSame || (!current && wanted.kilometres === null)) {
    return false;
  }
  if (current) {
    await withdrawReading(tx, actor, current.id);
  }
  if (wanted.kilometres !== null) {
    await addReading(tx, actor, vehicleId, wanted.kilometres, { recordedAt, source: "purchase" });
  }
  return true;
}

/** Records how a car was bought, or changes it: there is one per car. */
export async function savePurchase(
  database: AnyDatabase,
  actor: ActingUser,
  vehicleId: string,
  input: PurchaseInput,
  timeZone: string,
): Promise<SaveRecordResult> {
  const { kilometres, ...record } = input;
  return withTenant(database, actor.operatorId, async (tx) => {
    if (!(await findCurrentVehicle(tx, actor.operatorId, vehicleId))) {
      return "not_found";
    }
    const [before] = await tx
      .select()
      .from(vehiclePurchases)
      .where(
        and(
          eq(vehiclePurchases.vehicleId, vehicleId),
          eq(vehiclePurchases.operatorId, actor.operatorId),
        ),
      )
      .for("update");
    const isRecordChanged = await writePurchase(tx, actor, vehicleId, record, before);
    const isReadingChanged = await syncPurchaseReading(
      tx,
      actor,
      vehicleId,
      { kilometres, purchasedOn: record.purchasedOn },
      timeZone,
    );
    return isRecordChanged || isReadingChanged ? "saved" : "unchanged";
  });
}

async function writePurchase(
  tx: AnyTransaction,
  actor: ActingUser,
  vehicleId: string,
  record: PurchaseRecord,
  before: (PurchaseRecord & { id: string }) | undefined,
): Promise<boolean> {
  if (!before) {
    const [added] = await tx
      .insert(vehiclePurchases)
      .values({ ...record, operatorId: actor.operatorId, vehicleId })
      .returning({ id: vehiclePurchases.id });
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.vehiclePurchase,
      entityId: added!.id,
      action: ACTIVITY_ACTIONS.created,
      valuesAfter: withholdFields({ vehicleId, ...record }, PERSONAL_PURCHASE_FIELDS),
    });
    return true;
  }
  const changes = changedValues(before, record, PURCHASE_RECORD_FIELDS);
  if (!hasChanges(changes)) {
    return false;
  }
  await tx
    .update(vehiclePurchases)
    .set({ ...record, updatedAt: new Date() })
    .where(eq(vehiclePurchases.id, before.id));
  await recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.vehiclePurchase,
    entityId: before.id,
    action: ACTIVITY_ACTIONS.updated,
    ...withholdChangedFields(changes, PERSONAL_PURCHASE_FIELDS),
  });
  return true;
}

/** The car's sale that has not fallen through, locked for this transaction. */
async function lockActiveSale(tx: AnyTransaction, operatorId: string, vehicleId: string) {
  const [sale] = await tx
    .select()
    .from(vehicleSales)
    .where(
      and(
        eq(vehicleSales.vehicleId, vehicleId),
        eq(vehicleSales.operatorId, operatorId),
        isNull(vehicleSales.cancelledAt),
      ),
    )
    .for("update");
  return sale;
}

/** Records a car's sale, setting it to Sold, or changes the sale already recorded. */
export async function saveSale(
  database: AnyDatabase,
  actor: ActingUser,
  vehicleId: string,
  input: SaleInput,
): Promise<SaveRecordResult> {
  return withTenant(database, actor.operatorId, async (tx) => {
    if (!(await findCurrentVehicle(tx, actor.operatorId, vehicleId))) {
      return "not_found";
    }
    const before = await lockActiveSale(tx, actor.operatorId, vehicleId);
    if (before) {
      return updateSale(tx, actor, before.id, before, input);
    }
    const [added] = await tx
      .insert(vehicleSales)
      .values({ ...input, operatorId: actor.operatorId, vehicleId })
      .returning({ id: vehicleSales.id });
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.vehicleSale,
      entityId: added!.id,
      action: ACTIVITY_ACTIONS.created,
      valuesAfter: withholdFields({ vehicleId, ...input }, PERSONAL_SALE_FIELDS),
    });
    await applyVehicleStatus(tx, actor, vehicleId, statusOnly("sold"));
    return "saved";
  });
}

async function updateSale(
  tx: AnyTransaction,
  actor: ActingUser,
  saleId: string,
  before: SaleInput,
  input: SaleInput,
): Promise<SaveRecordResult> {
  const changes = changedValues(before, input, SALE_FIELDS);
  if (!hasChanges(changes)) {
    return "unchanged";
  }
  await tx
    .update(vehicleSales)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(vehicleSales.id, saleId));
  await recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.vehicleSale,
    entityId: saleId,
    action: ACTIVITY_ACTIONS.updated,
    ...withholdChangedFields(changes, PERSONAL_SALE_FIELDS),
  });
  return "saved";
}

/**
 * A sale that fell through: kept on record, marked cancelled, and the car
 * goes back to Available unless its status was changed since.
 */
export async function cancelSale(
  database: AnyDatabase,
  actor: ActingUser,
  vehicleId: string,
): Promise<"cancelled" | "not_found"> {
  return withTenant(database, actor.operatorId, async (tx) => {
    if (!(await findCurrentVehicle(tx, actor.operatorId, vehicleId))) {
      return "not_found";
    }
    const sale = await lockActiveSale(tx, actor.operatorId, vehicleId);
    if (!sale) {
      return "not_found";
    }
    await tx
      .update(vehicleSales)
      .set({ cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(vehicleSales.id, sale.id));
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.vehicleSale,
      entityId: sale.id,
      action: ACTIVITY_ACTIONS.cancelled,
    });
    const [car] = await tx
      .select({ status: vehicles.status })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId));
    if (car?.status === "sold") {
      await applyVehicleStatus(tx, actor, vehicleId, statusOnly("available"));
    }
    return "cancelled";
  });
}

/** Records one other cost of a car: a refurb, a repair or anything else. */
export async function addCost(
  database: AnyDatabase,
  actor: ActingUser,
  vehicleId: string,
  input: CostInput,
): Promise<"added" | "not_found"> {
  return withTenant(database, actor.operatorId, async (tx) => {
    if (!(await findCurrentVehicle(tx, actor.operatorId, vehicleId))) {
      return "not_found";
    }
    const [added] = await tx
      .insert(vehicleCosts)
      .values({ ...input, operatorId: actor.operatorId, vehicleId })
      .returning({ id: vehicleCosts.id });
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.vehicleCost,
      entityId: added!.id,
      action: ACTIVITY_ACTIONS.created,
      valuesAfter: { vehicleId, ...input },
    });
    return "added";
  });
}

/** Takes a cost entered by mistake off the list. It stays on record (rule 13). */
export async function archiveCost(
  database: AnyDatabase,
  actor: ActingUser,
  costId: string,
): Promise<"archived" | "not_found"> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const [archived] = await tx
      .update(vehicleCosts)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(vehicleCosts.id, costId),
          eq(vehicleCosts.operatorId, actor.operatorId),
          isNull(vehicleCosts.archivedAt),
        ),
      )
      .returning({ id: vehicleCosts.id });
    if (!archived) {
      return "not_found";
    }
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.vehicleCost,
      entityId: costId,
      action: ACTIVITY_ACTIONS.archived,
    });
    return "archived";
  });
}
