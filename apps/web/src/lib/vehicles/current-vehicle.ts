import type { AnyTransaction } from "@fleetapp/db/client";
import { vehicles } from "@fleetapp/db/schema";
import { and, eq, isNull } from "drizzle-orm";

/** The Operator's car, if it is still current (an archived car is read-only). */
export async function findCurrentVehicle(
  tx: AnyTransaction,
  operatorId: string,
  vehicleId: string,
): Promise<{ id: string } | undefined> {
  const [vehicle] = await tx
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(
      and(
        eq(vehicles.id, vehicleId),
        eq(vehicles.operatorId, operatorId),
        isNull(vehicles.archivedAt),
      ),
    );
  return vehicle;
}
