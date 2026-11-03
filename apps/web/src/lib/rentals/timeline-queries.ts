import type { ListQuery } from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import { possessions, renters } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, asc, eq, gt, isNotNull, lt } from "drizzle-orm";

import { listVehiclesForExport, type VehicleSummary } from "../vehicles/vehicle-queries";

/** A finished spell with a car: who had it, from when to when (rule 15). */
export interface PastPossession {
  rentalId: string;
  vehicleId: string;
  renterFullName: string;
  startedAt: Date;
  endedAt: Date;
}

/**
 * Every finished possession that overlaps the window: a rental since
 * returned, or a car handed back in a swap. The timeline's past, as holds
 * are released at the return. One still open is the rental out now, which
 * its live hold already shows.
 */
export async function listPastPossessions(
  database: AnyDatabase,
  operatorId: string,
  window: { from: Date; to: Date },
): Promise<PastPossession[]> {
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        rentalId: possessions.rentalId,
        vehicleId: possessions.vehicleId,
        renterFullName: renters.fullName,
        startedAt: possessions.startedAt,
        endedAt: possessions.endedAt,
      })
      .from(possessions)
      .innerJoin(
        renters,
        and(eq(renters.id, possessions.renterId), eq(renters.operatorId, possessions.operatorId)),
      )
      .where(
        and(
          eq(possessions.operatorId, operatorId),
          isNotNull(possessions.endedAt),
          lt(possessions.startedAt, window.to),
          gt(possessions.endedAt, window.from),
        ),
      )
      .orderBy(asc(possessions.startedAt)),
  );
  return rows.flatMap((row) => (row.endedAt ? [{ ...row, endedAt: row.endedAt }] : []));
}

/** Every current car by rego, as the cars list sees it. */
const ALL_CARS_BY_REGO: ListQuery = {
  search: "",
  sort: { column: "rego", direction: "asc" },
  filters: {},
  page: 1,
};
/** Cars that have left the fleet have no future to plan. */
const CARS_GONE: readonly VehicleSummary["status"][] = ["sold", "written_off"];

/** The cars on the timeline: every current car still in the fleet, by rego. */
export async function listTimelineCars(
  database: AnyDatabase,
  operatorId: string,
): Promise<VehicleSummary[]> {
  const cars = await listVehiclesForExport(database, operatorId, ALL_CARS_BY_REGO);
  return cars.filter((car) => !CARS_GONE.includes(car.status));
}
