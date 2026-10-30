import { changedValues, hasChanges, isUniqueViolation } from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  VEHICLE_REGO_UNIQUE_INDEX,
  VEHICLE_VIN_UNIQUE_INDEX,
  vehicles,
  type ActivityAction,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, isNotNull, isNull } from "drizzle-orm";

import { recordUserChange, type ActingUser, type UserChange } from "../acting-user";
import { addReading } from "./odometer";
import type { NewVehicleInput, VehicleInput, VehicleStatusInput } from "./vehicle-input";

/** The car fields the add and edit form sets. */
const VEHICLE_FIELDS = [
  "rego",
  "regoState",
  "vin",
  "make",
  "model",
  "variant",
  "year",
  "colour",
  "bodyType",
  "transmission",
  "fuelType",
  "seats",
] as const satisfies readonly (keyof VehicleInput)[];

const STATUS_FIELDS = ["status", "statusReason", "statusExpectedBack"] as const;

type Vehicle = typeof vehicles.$inferSelect;

/** Another car of this Operator's already has the rego or VIN; `existingVehicleId` links to it. */
export interface DuplicateVehicle {
  status: "duplicate";
  field: "rego" | "vin";
  existingVehicleId: string | null;
}

export type SaveVehicleResult = { status: "saved"; vehicleId: string } | DuplicateVehicle;

/** Changes to an archived car wait until it is restored. */
export type ChangeVehicleResult = "changed" | "unchanged" | "not_found";

function pickVehicleFields(
  input: VehicleInput | NewVehicleInput,
): Pick<Vehicle, (typeof VEHICLE_FIELDS)[number]> {
  return Object.fromEntries(VEHICLE_FIELDS.map((field) => [field, input[field]])) as Pick<
    Vehicle,
    (typeof VEHICLE_FIELDS)[number]
  >;
}

/**
 * The car already holding this rego or VIN, after the database refused a
 * second one. Found in a fresh transaction: the refused one is over.
 */
async function findDuplicate(
  database: AnyDatabase,
  operatorId: string,
  error: unknown,
  car: Pick<Vehicle, "rego" | "regoState" | "vin">,
): Promise<DuplicateVehicle | null> {
  const field = isUniqueViolation(error, VEHICLE_REGO_UNIQUE_INDEX)
    ? "rego"
    : isUniqueViolation(error, VEHICLE_VIN_UNIQUE_INDEX)
      ? "vin"
      : null;
  if (!field) {
    return null;
  }
  const sameCar =
    field === "rego"
      ? and(eq(vehicles.rego, car.rego), eq(vehicles.regoState, car.regoState))
      : eq(vehicles.vin, car.vin ?? "");
  const [existing] = await withTenant(database, operatorId, (tx) =>
    tx
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(and(eq(vehicles.operatorId, operatorId), isNull(vehicles.archivedAt), sameCar)),
  );
  return { status: "duplicate", field, existingVehicleId: existing?.id ?? null };
}

/** Runs a write that may hit the one-rego or one-VIN rule, turning that refusal into an answer. */
async function saveOrReportDuplicate<Result>(
  database: AnyDatabase,
  operatorId: string,
  car: Pick<Vehicle, "rego" | "regoState" | "vin">,
  save: () => Promise<Result>,
): Promise<Result | DuplicateVehicle> {
  try {
    return await save();
  } catch (error) {
    const duplicate = await findDuplicate(database, operatorId, error, car);
    if (duplicate) {
      return duplicate;
    }
    throw error;
  }
}

/** The Operator's car, locked for this transaction, or nothing if it is not theirs. */
async function lockVehicle(
  tx: AnyTransaction,
  operatorId: string,
  vehicleId: string,
): Promise<Vehicle | undefined> {
  const [vehicle] = await tx
    .select()
    .from(vehicles)
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.operatorId, operatorId)))
    .for("update");
  return vehicle;
}

function logVehicleActivity(
  tx: AnyTransaction,
  actor: ActingUser,
  vehicleId: string,
  action: ActivityAction,
  values: Pick<UserChange, "valuesBefore" | "valuesAfter"> = {},
): Promise<void> {
  return recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.vehicle,
    entityId: vehicleId,
    action,
    ...values,
  });
}

/**
 * Adds a car, with its first odometer reading, to the signed-in User's
 * Operator (never one named by the form: rule 1).
 */
export async function createVehicle(
  database: AnyDatabase,
  actor: ActingUser,
  input: NewVehicleInput,
): Promise<SaveVehicleResult> {
  const fields = pickVehicleFields(input);
  return saveOrReportDuplicate(database, actor.operatorId, fields, () =>
    withTenant(database, actor.operatorId, async (tx) => {
      const [created] = await tx
        .insert(vehicles)
        .values({ ...fields, operatorId: actor.operatorId })
        .returning({ id: vehicles.id });
      if (!created) {
        throw new Error("The car was not saved.");
      }
      await logVehicleActivity(tx, actor, created.id, ACTIVITY_ACTIONS.created, {
        valuesAfter: fields,
      });
      await addReading(tx, actor, created.id, input.kilometres);
      return { status: "saved" as const, vehicleId: created.id };
    }),
  );
}

/** Saves the edit form, logging only what changed. An archived car is left alone. */
export async function updateVehicle(
  database: AnyDatabase,
  actor: ActingUser,
  vehicleId: string,
  input: VehicleInput,
): Promise<SaveVehicleResult | { status: "not_found" }> {
  const fields = pickVehicleFields(input);
  return saveOrReportDuplicate(database, actor.operatorId, fields, () =>
    withTenant(database, actor.operatorId, async (tx) => {
      const before = await lockVehicle(tx, actor.operatorId, vehicleId);
      if (!before || before.archivedAt) {
        return { status: "not_found" as const };
      }
      const changes = changedValues(before, fields, VEHICLE_FIELDS);
      if (hasChanges(changes)) {
        await tx.update(vehicles).set(fields).where(eq(vehicles.id, vehicleId));
        await logVehicleActivity(tx, actor, vehicleId, ACTIVITY_ACTIONS.updated, changes);
      }
      return { status: "saved" as const, vehicleId };
    }),
  );
}

/** Sets a car's status, with the reason and return date when it is off the road for a while. */
export async function changeVehicleStatus(
  database: AnyDatabase,
  actor: ActingUser,
  vehicleId: string,
  input: VehicleStatusInput,
): Promise<ChangeVehicleResult> {
  return withTenant(database, actor.operatorId, (tx) =>
    applyVehicleStatus(tx, actor, vehicleId, input),
  );
}

/** As `changeVehicleStatus`, inside the caller's transaction: e.g. Sold, when a sale is saved. */
export async function applyVehicleStatus(
  tx: AnyTransaction,
  actor: ActingUser,
  vehicleId: string,
  input: VehicleStatusInput,
): Promise<ChangeVehicleResult> {
  const before = await lockVehicle(tx, actor.operatorId, vehicleId);
  if (!before || before.archivedAt) {
    return "not_found";
  }
  const changes = changedValues(before, input, STATUS_FIELDS);
  if (!hasChanges(changes)) {
    return "unchanged";
  }
  await tx.update(vehicles).set(input).where(eq(vehicles.id, vehicleId));
  await logVehicleActivity(tx, actor, vehicleId, ACTIVITY_ACTIONS.statusChanged, changes);
  return "changed";
}

/**
 * Archives a car (hidden from the list, all history kept: rule 13) or brings
 * one back. Bringing one back is refused while another car has its rego or VIN.
 */
async function setVehicleArchived(
  database: AnyDatabase,
  actor: ActingUser,
  vehicleId: string,
  shouldArchive: boolean,
): Promise<ChangeVehicleResult | DuplicateVehicle> {
  const [car] = await withTenant(database, actor.operatorId, (tx) =>
    tx
      .select({ rego: vehicles.rego, regoState: vehicles.regoState, vin: vehicles.vin })
      .from(vehicles)
      .where(and(eq(vehicles.id, vehicleId), eq(vehicles.operatorId, actor.operatorId))),
  );
  if (!car) {
    return "not_found";
  }
  return saveOrReportDuplicate(database, actor.operatorId, car, () =>
    withTenant(database, actor.operatorId, async (tx) => {
      const [changed] = await tx
        .update(vehicles)
        .set({ archivedAt: shouldArchive ? new Date() : null })
        .where(
          and(
            eq(vehicles.id, vehicleId),
            eq(vehicles.operatorId, actor.operatorId),
            shouldArchive ? isNull(vehicles.archivedAt) : isNotNull(vehicles.archivedAt),
          ),
        )
        .returning({ id: vehicles.id });
      if (!changed) {
        return "unchanged" as const;
      }
      const action = shouldArchive ? ACTIVITY_ACTIONS.archived : ACTIVITY_ACTIONS.restored;
      await logVehicleActivity(tx, actor, vehicleId, action);
      return "changed" as const;
    }),
  );
}

export function archiveVehicle(
  database: AnyDatabase,
  actor: ActingUser,
  vehicleId: string,
): Promise<ChangeVehicleResult | DuplicateVehicle> {
  return setVehicleArchived(database, actor, vehicleId, true);
}

export function restoreVehicle(
  database: AnyDatabase,
  actor: ActingUser,
  vehicleId: string,
): Promise<ChangeVehicleResult | DuplicateVehicle> {
  return setVehicleArchived(database, actor, vehicleId, false);
}
