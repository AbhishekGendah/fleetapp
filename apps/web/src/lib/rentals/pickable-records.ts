import { renterDisplayName, VEHICLE_STATUS_LABELS } from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import { renters, vehicles } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { PickableRecord } from "@fleetapp/ui/record-picker";
import { and, asc, eq, isNull, notInArray } from "drizzle-orm";

/** Cars that have left the fleet can never be booked, so they are not offered. */
const CARS_GONE = ["sold", "written_off"] as const;

/** The Operator's current Renters, by name; Do not rent ones are left out. */
export async function listPickableRenters(
  database: AnyDatabase,
  operatorId: string,
): Promise<PickableRecord[]> {
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        id: renters.id,
        fullName: renters.fullName,
        preferredName: renters.preferredName,
        phone: renters.phone,
        email: renters.email,
      })
      .from(renters)
      .where(
        and(
          eq(renters.operatorId, operatorId),
          isNull(renters.archivedAt),
          eq(renters.status, "active"),
        ),
      )
      .orderBy(asc(renters.fullName)),
  );
  return rows.map((row) => ({
    value: row.id,
    label: renterDisplayName(row.fullName, row.preferredName),
    description: [row.phone, row.email].filter(Boolean).join(" · ") || undefined,
  }));
}

/** The Operator's current cars that can still be booked (or, for a swap, only Available ones), by rego. */
export async function listPickableCars(
  database: AnyDatabase,
  operatorId: string,
  options: { isAvailableOnly?: boolean } = {},
): Promise<PickableRecord[]> {
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        id: vehicles.id,
        rego: vehicles.rego,
        make: vehicles.make,
        model: vehicles.model,
        status: vehicles.status,
      })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.operatorId, operatorId),
          isNull(vehicles.archivedAt),
          notInArray(vehicles.status, [...CARS_GONE]),
          options.isAvailableOnly ? eq(vehicles.status, "available") : undefined,
        ),
      )
      .orderBy(asc(vehicles.rego)),
  );
  return rows.map((row) => ({
    value: row.id,
    label: row.rego,
    description: `${row.make} ${row.model} · ${VEHICLE_STATUS_LABELS[row.status]}`,
  }));
}

/** A car's prices as the booking form fills them in: daily rate and long-term weekly price. */
export interface CarPrices {
  dailyRateCents: number | null;
  longTermWeeklyCents: number | null;
}

/** Each bookable car's prices, so choosing a car fills the booking form's price boxes. */
export async function listCarPrices(
  database: AnyDatabase,
  operatorId: string,
): Promise<Record<string, CarPrices>> {
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        id: vehicles.id,
        dailyRateCents: vehicles.dailyRateCents,
        longTermWeeklyCents: vehicles.longTermWeeklyCents,
      })
      .from(vehicles)
      .where(and(eq(vehicles.operatorId, operatorId), isNull(vehicles.archivedAt))),
  );
  return Object.fromEntries(rows.map(({ id, ...prices }) => [id, prices]));
}
