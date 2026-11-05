import type { VehicleStatus } from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";
import { vehicles } from "@fleetapp/db/schema";
import { and, eq, isNull, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { qualified } from "@fleetapp/db/qualified";

/** The Operator's car, if it is still current (an archived car is read-only). */
export async function findCurrentVehicle(
  tx: AnyTransaction,
  operatorId: string,
  vehicleId: string,
): Promise<{ id: string; status: VehicleStatus } | undefined> {
  const [vehicle] = await currentVehicleQuery(tx, operatorId, vehicleId);
  return vehicle;
}

/**
 * As `findCurrentVehicle`, locked for this transaction: a sale and a
 * handover of the same car then happen one after the other, the second
 * seeing what the first did (review A8-4).
 */
export async function lockCurrentVehicle(
  tx: AnyTransaction,
  operatorId: string,
  vehicleId: string,
): Promise<{ id: string; status: VehicleStatus } | undefined> {
  const [vehicle] = await currentVehicleQuery(tx, operatorId, vehicleId).for("update");
  return vehicle;
}

function currentVehicleQuery(tx: AnyTransaction, operatorId: string, vehicleId: string) {
  return tx
    .select({ id: vehicles.id, status: vehicles.status })
    .from(vehicles)
    .where(
      and(
        eq(vehicles.id, vehicleId),
        eq(vehicles.operatorId, operatorId),
        isNull(vehicles.archivedAt),
      ),
    );
}

/**
 * The record is of a car still current: an archived car is read-only, even
 * from a page left open from before it was archived (review A8-7).
 */
export function isOfCurrentCar(vehicleIdColumn: AnyColumn): SQL {
  return sql`exists (
    select 1 from ${vehicles}
    where ${qualified(vehicles.id)} = ${qualified(vehicleIdColumn)}
      and ${qualified(vehicles.archivedAt)} is null
  )`;
}
