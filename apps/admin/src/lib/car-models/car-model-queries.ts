import { operatorDisplayName } from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import { operators, vehicleMakes, vehicleModels } from "@fleetapp/db/schema";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

export interface CatalogueEntrySummary {
  id: string;
  name: string;
  aliases: string[];
  hiddenAt: Date | null;
}

export interface MakeSummary extends CatalogueEntrySummary {
  /** Models shown to Operators: hidden ones are not counted. */
  modelCount: number;
}

/** Every make, hidden ones too, with how many models each shows. */
export async function listMakes(database: AnyDatabase): Promise<MakeSummary[]> {
  return database
    .select({
      id: vehicleMakes.id,
      name: vehicleMakes.name,
      aliases: vehicleMakes.aliases,
      hiddenAt: vehicleMakes.hiddenAt,
      modelCount: sql<number>`count(${vehicleModels.id}) filter (where ${vehicleModels.hiddenAt} is null)::int`,
    })
    .from(vehicleMakes)
    .leftJoin(vehicleModels, eq(vehicleModels.makeId, vehicleMakes.id))
    .groupBy(vehicleMakes.id)
    .orderBy(asc(vehicleMakes.name));
}

const entryColumns = (table: typeof vehicleMakes | typeof vehicleModels) => ({
  id: table.id,
  name: table.name,
  aliases: table.aliases,
  hiddenAt: table.hiddenAt,
});

/** One make with all its models, hidden ones too, or null. */
export async function loadMake(
  database: AnyDatabase,
  makeId: string,
): Promise<(CatalogueEntrySummary & { models: CatalogueEntrySummary[] }) | null> {
  const [make] = await database
    .select(entryColumns(vehicleMakes))
    .from(vehicleMakes)
    .where(eq(vehicleMakes.id, makeId));
  if (!make) {
    return null;
  }
  const models = await database
    .select(entryColumns(vehicleModels))
    .from(vehicleModels)
    .where(eq(vehicleModels.makeId, makeId))
    .orderBy(asc(vehicleModels.name));
  return { ...make, models };
}

/** One model and the make it is under, or null. */
export async function loadModel(
  database: AnyDatabase,
  modelId: string,
): Promise<(CatalogueEntrySummary & { makeId: string; makeName: string }) | null> {
  const [model] = await database
    .select({
      ...entryColumns(vehicleModels),
      makeId: vehicleMakes.id,
      makeName: vehicleMakes.name,
    })
    .from(vehicleModels)
    .innerJoin(vehicleMakes, eq(vehicleMakes.id, vehicleModels.makeId))
    .where(eq(vehicleModels.id, modelId));
  return model ?? null;
}

const unlistedRowSchema = z.object({
  vehicle_id: z.string(),
  operator_id: z.string(),
  make: z.string(),
  model: z.string(),
  created_at: z.coerce.date(),
});

export interface UnlistedCar {
  vehicleId: string;
  operatorName: string;
  make: string;
  model: string;
  addedAt: Date;
}

/**
 * Cars whose make or model is not in the list, one line per car, with the
 * Operator's business name. Read through the one function that lets the
 * admin app see cars at all; nothing else about the car comes with it.
 */
export async function listUnlistedCars(database: AnyDatabase): Promise<UnlistedCar[]> {
  const result = await database.execute(sql`select * from app.vehicles_not_in_catalogue()`);
  const rows = z.object({ rows: z.array(unlistedRowSchema) }).parse(result).rows;
  if (rows.length === 0) {
    return [];
  }
  const operatorRows = await database
    .select({
      id: operators.id,
      legalName: operators.legalName,
      tradingName: operators.tradingName,
    })
    .from(operators)
    .where(inArray(operators.id, [...new Set(rows.map((row) => row.operator_id))]));
  const names = new Map(
    operatorRows.map((operator) => [operator.id, operatorDisplayName(operator)]),
  );
  return rows.map((row) => ({
    vehicleId: row.vehicle_id,
    operatorName: names.get(row.operator_id) ?? "Unknown Operator",
    make: row.make,
    model: row.model,
    addedAt: row.created_at,
  }));
}
