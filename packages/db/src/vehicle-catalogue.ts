import type { VehicleCatalogue } from "@fleetapp/core";
import type { AnyDatabase } from "./client";
import { vehicleMakes, vehicleModels } from "./schema";
import { and, asc, eq, isNull } from "drizzle-orm";

/**
 * The shared list of makes and models, as AGS keeps it on the admin site.
 * Hidden entries are left out. Read fresh each time, so an admin change
 * reaches every Operator at once. Not tenant data: every Operator reads the same list.
 */
export async function loadVehicleCatalogue(database: AnyDatabase): Promise<VehicleCatalogue> {
  const rows = await database
    .select({
      makeId: vehicleMakes.id,
      make: vehicleMakes.name,
      makeAliases: vehicleMakes.aliases,
      model: vehicleModels.name,
      modelAliases: vehicleModels.aliases,
    })
    .from(vehicleMakes)
    .leftJoin(
      vehicleModels,
      and(eq(vehicleModels.makeId, vehicleMakes.id), isNull(vehicleModels.hiddenAt)),
    )
    .where(isNull(vehicleMakes.hiddenAt))
    .orderBy(asc(vehicleMakes.name), asc(vehicleModels.name));

  const makes = new Map<
    string,
    { name: string; aliases: string[]; models: { name: string; aliases: string[] }[] }
  >();
  for (const row of rows) {
    const make = makes.get(row.makeId) ?? { name: row.make, aliases: row.makeAliases, models: [] };
    if (row.model !== null) {
      make.models.push({ name: row.model, aliases: row.modelAliases ?? [] });
    }
    makes.set(row.makeId, make);
  }
  return [...makes.values()];
}
