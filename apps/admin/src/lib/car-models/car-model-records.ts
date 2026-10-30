import { changedValues, findListedName, hasChanges, isUniqueViolation } from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ADMIN_ACTIVITY_ACTIONS,
  ADMIN_ACTIVITY_ENTITY_TYPES,
  vehicleMakes,
  vehicleModels,
} from "@fleetapp/db/schema";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { recordAdminChange } from "./admin-change";
import type { CatalogueEntryInput } from "./car-model-input";

const MAKE_UNIQUE_INDEX = "vehicle_makes_name_unique";
const MODEL_UNIQUE_INDEX = "vehicle_models_name_unique";

/** A make or a model: they are kept the same way, in two tables. */
const ENTRY_KINDS = {
  make: {
    table: vehicleMakes,
    entityType: ADMIN_ACTIVITY_ENTITY_TYPES.vehicleMake,
    uniqueIndex: MAKE_UNIQUE_INDEX,
  },
  model: {
    table: vehicleModels,
    entityType: ADMIN_ACTIVITY_ENTITY_TYPES.vehicleModel,
    uniqueIndex: MODEL_UNIQUE_INDEX,
  },
} as const;
export type CatalogueEntryKind = keyof typeof ENTRY_KINDS;

export type SaveEntryResult = "saved" | "unchanged" | "duplicate" | "not_found";

const ENTRY_FIELDS = ["name", "aliases"] as const;

function isSameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Runs a write that may hit the one-name-per-make rule, turning that refusal into "duplicate". */
async function orDuplicate<Result>(
  uniqueIndex: string,
  write: () => Promise<Result>,
): Promise<Result | "duplicate"> {
  try {
    return await write();
  } catch (error) {
    if (isUniqueViolation(error, uniqueIndex)) {
      return "duplicate";
    }
    throw error;
  }
}

/** Renames a make or model, or changes its nicknames. Cars already saved keep their words. */
export async function updateCatalogueEntry(
  database: AnyDatabase,
  adminUserId: string,
  kind: CatalogueEntryKind,
  entryId: string,
  input: CatalogueEntryInput,
): Promise<SaveEntryResult> {
  const { table, entityType, uniqueIndex } = ENTRY_KINDS[kind];
  return orDuplicate(uniqueIndex, () =>
    database.transaction(async (tx) => {
      const [before] = await tx
        .select({ name: table.name, aliases: table.aliases })
        .from(table)
        .where(eq(table.id, entryId))
        .for("update");
      if (!before) {
        return "not_found" as const;
      }
      const changes = changedValues(
        { name: before.name, aliases: before.aliases.join(", ") },
        { name: input.name, aliases: input.aliases.join(", ") },
        ENTRY_FIELDS,
      );
      if (!hasChanges(changes) && isSameList(before.aliases, input.aliases)) {
        return "unchanged" as const;
      }
      await tx
        .update(table)
        .set({ name: input.name, aliases: input.aliases, updatedAt: new Date() })
        .where(eq(table.id, entryId));
      await recordAdminChange(tx, adminUserId, {
        action: ADMIN_ACTIVITY_ACTIONS.updated,
        entityType,
        entityId: entryId,
        ...changes,
      });
      return "saved" as const;
    }),
  );
}

/** Hides a make or model from suggestions, or shows it again. Nothing is ever deleted. */
export async function setCatalogueEntryHidden(
  database: AnyDatabase,
  adminUserId: string,
  kind: CatalogueEntryKind,
  entryId: string,
  isHidden: boolean,
): Promise<"changed" | "not_found"> {
  const { table, entityType } = ENTRY_KINDS[kind];
  return database.transaction(async (tx) => {
    const [changed] = await tx
      .update(table)
      .set({ hiddenAt: isHidden ? new Date() : null, updatedAt: new Date() })
      .where(eq(table.id, entryId))
      .returning({ id: table.id });
    if (!changed) {
      return "not_found";
    }
    await recordAdminChange(tx, adminUserId, {
      action: isHidden ? ADMIN_ACTIVITY_ACTIONS.hidden : ADMIN_ACTIVITY_ACTIONS.shown,
      entityType,
      entityId: entryId,
    });
    return "changed";
  });
}

/** Adds a make to the list. */
export async function createMake(
  database: AnyDatabase,
  adminUserId: string,
  input: CatalogueEntryInput,
): Promise<{ status: "created"; makeId: string } | "duplicate"> {
  return orDuplicate(MAKE_UNIQUE_INDEX, () =>
    database.transaction(async (tx) => {
      const makeId = await insertMake(tx, adminUserId, input);
      return { status: "created" as const, makeId };
    }),
  );
}

async function insertMake(
  tx: AnyTransaction,
  adminUserId: string,
  input: CatalogueEntryInput,
): Promise<string> {
  const [make] = await tx.insert(vehicleMakes).values(input).returning({ id: vehicleMakes.id });
  if (!make) {
    throw new Error("The make was not saved.");
  }
  await recordAdminChange(tx, adminUserId, {
    action: ADMIN_ACTIVITY_ACTIONS.created,
    entityType: ADMIN_ACTIVITY_ENTITY_TYPES.vehicleMake,
    entityId: make.id,
    valuesAfter: input,
  });
  return make.id;
}

export interface AddModelsResult {
  added: string[];
  /** Already listed under this make, spelt the same or near enough ("sealion6" for "Sealion 6"). */
  alreadyListed: string[];
}

async function insertModels(
  tx: AnyTransaction,
  adminUserId: string,
  makeId: string,
  names: readonly string[],
): Promise<AddModelsResult> {
  const existing = await tx
    .select({ name: vehicleModels.name, aliases: vehicleModels.aliases })
    .from(vehicleModels)
    .where(eq(vehicleModels.makeId, makeId));
  const alreadyListed = names.filter((name) => findListedName(existing, name) !== null);
  const added = names.filter((name) => !alreadyListed.includes(name));
  for (const name of added) {
    const [model] = await tx
      .insert(vehicleModels)
      .values({ makeId, name })
      .returning({ id: vehicleModels.id });
    await recordAdminChange(tx, adminUserId, {
      action: ADMIN_ACTIVITY_ACTIONS.created,
      entityType: ADMIN_ACTIVITY_ENTITY_TYPES.vehicleModel,
      entityId: model!.id,
      valuesAfter: { makeId, name },
    });
  }
  return { added, alreadyListed };
}

/** Adds models under a make, skipping any already listed there. */
export async function addModels(
  database: AnyDatabase,
  adminUserId: string,
  makeId: string,
  names: readonly string[],
): Promise<AddModelsResult | "not_found"> {
  return database.transaction(async (tx) => {
    const [make] = await tx
      .select({ id: vehicleMakes.id })
      .from(vehicleMakes)
      .where(eq(vehicleMakes.id, makeId));
    return make ? insertModels(tx, adminUserId, makeId, names) : "not_found";
  });
}

/**
 * "Add to list" from the Typed by Operators page: the make (if new) and the
 * model (if new), in the spelling chosen.
 */
export async function addMakeAndModel(
  database: AnyDatabase,
  adminUserId: string,
  car: { make: string; model: string },
): Promise<AddModelsResult> {
  return database.transaction(async (tx) => {
    const makes = await tx
      .select({ id: vehicleMakes.id, name: vehicleMakes.name, aliases: vehicleMakes.aliases })
      .from(vehicleMakes);
    const listedName = findListedName(makes, car.make);
    const makeId =
      makes.find((make) => make.name === listedName)?.id ??
      (await insertMake(tx, adminUserId, { name: car.make, aliases: [] }));
    return insertModels(tx, adminUserId, makeId, [car.model]);
  });
}

const fixResultSchema = z.object({ rows: z.array(z.object({ fixed: z.boolean().nullable() })) });

/**
 * "Fix this car": changes one Operator's car to the chosen make and model,
 * through the one database function the admin app may use on cars. It logs
 * the change in that Operator's history as an Admin's; this logs it in AGS's.
 */
export async function fixCarMakeAndModel(
  database: AnyDatabase,
  adminUserId: string,
  vehicleId: string,
  car: { make: string; model: string },
): Promise<"fixed" | "not_found"> {
  return database.transaction(async (tx) => {
    const result = await tx.execute(
      sql`select app.correct_vehicle_make_model(${vehicleId}::uuid, ${car.make}, ${car.model}, ${adminUserId}::uuid) as fixed`,
    );
    if (fixResultSchema.parse(result).rows[0]?.fixed !== true) {
      return "not_found";
    }
    await recordAdminChange(tx, adminUserId, {
      action: ADMIN_ACTIVITY_ACTIONS.vehicleCorrected,
      entityType: ADMIN_ACTIVITY_ENTITY_TYPES.vehicle,
      entityId: vehicleId,
      valuesAfter: car,
    });
    return "fixed";
  });
}
