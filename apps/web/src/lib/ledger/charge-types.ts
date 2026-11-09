import {
  BUILT_IN_CHARGE_TYPE_LABELS,
  BUILT_IN_CHARGE_TYPES,
  type BuiltInChargeType,
  type GstTreatment,
} from "@fleetapp/core";
import { recordActivity } from "@fleetapp/db/activity";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, chargeTypes } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { ROW_LOCK } from "@fleetapp/db/row-lock";
import { and, asc, eq, isNull } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import type { ChargeTypeInput } from "./ledger-input";

export interface ChargeType {
  id: string;
  builtIn: BuiltInChargeType | null;
  label: string;
  gstTreatment: GstTreatment;
  isArchived: boolean;
}

type ChargeTypeRow = typeof chargeTypes.$inferSelect;

function chargeTypeOf(row: ChargeTypeRow): ChargeType {
  return {
    id: row.id,
    builtIn: row.builtIn,
    label: row.builtIn ? BUILT_IN_CHARGE_TYPE_LABELS[row.builtIn] : (row.name ?? ""),
    gstTreatment: row.gstTreatment,
    isArchived: row.archivedAt !== null,
  };
}

/**
 * Adds any built-in type the business does not have yet (one row each, so
 * running it again adds nothing). Done in the business's own tenant context
 * when the types are first needed; each one added gets its history line,
 * by the system (rule 19, review A8-8).
 */
export async function ensureBuiltInChargeTypes(
  tx: AnyTransaction,
  operatorId: string,
): Promise<void> {
  const added = await tx
    .insert(chargeTypes)
    .values(BUILT_IN_CHARGE_TYPES.map((builtIn) => ({ operatorId, builtIn })))
    .onConflictDoNothing()
    .returning({ id: chargeTypes.id, builtIn: chargeTypes.builtIn });
  for (const chargeType of added) {
    await recordActivity(tx, {
      operatorId,
      actor: { type: "system", id: null },
      entityType: ACTIVITY_ENTITY_TYPES.chargeType,
      entityId: chargeType.id,
      action: ACTIVITY_ACTIONS.created,
      valuesAfter: { builtIn: chargeType.builtIn },
    });
  }
}

/** Every charge type, built-in first in their usual order, then the business's own by name. */
export async function selectChargeTypes(
  tx: AnyTransaction,
  operatorId: string,
): Promise<ChargeType[]> {
  await ensureBuiltInChargeTypes(tx, operatorId);
  const rows = await tx
    .select()
    .from(chargeTypes)
    .where(eq(chargeTypes.operatorId, operatorId))
    .orderBy(asc(chargeTypes.name));
  const builtInOrder = (row: ChargeTypeRow) =>
    row.builtIn ? BUILT_IN_CHARGE_TYPES.indexOf(row.builtIn) : BUILT_IN_CHARGE_TYPES.length;
  return [...rows]
    .sort((first, second) => builtInOrder(first) - builtInOrder(second))
    .map(chargeTypeOf);
}

export function listChargeTypes(database: AnyDatabase, operatorId: string): Promise<ChargeType[]> {
  return withTenant(database, operatorId, (tx) => selectChargeTypes(tx, operatorId));
}

/** A built-in type's row, e.g. weekly rent for the daily job. */
export async function builtInChargeType(
  tx: AnyTransaction,
  operatorId: string,
  builtIn: BuiltInChargeType,
): Promise<ChargeType> {
  const found = (await selectChargeTypes(tx, operatorId)).find((type) => type.builtIn === builtIn);
  if (!found) {
    throw new Error(`The built-in ${builtIn} charge type is missing.`);
  }
  return found;
}

/** A type a new charge can use: this business's, and not archived. */
export async function usableChargeType(
  tx: AnyTransaction,
  operatorId: string,
  chargeTypeId: string,
): Promise<ChargeType | null> {
  const [row] = await tx
    .select()
    .from(chargeTypes)
    .where(
      and(
        eq(chargeTypes.id, chargeTypeId),
        eq(chargeTypes.operatorId, operatorId),
        isNull(chargeTypes.archivedAt),
      ),
    );
  return row ? chargeTypeOf(row) : null;
}

/** Adds one of the business's own charge types. */
export async function addChargeType(
  database: AnyDatabase,
  actor: ActingUser,
  input: ChargeTypeInput,
): Promise<string> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const [row] = await tx
      .insert(chargeTypes)
      .values({ operatorId: actor.operatorId, name: input.name, gstTreatment: input.gstTreatment })
      .returning({ id: chargeTypes.id });
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.chargeType,
      entityId: row!.id,
      action: ACTIVITY_ACTIONS.created,
      valuesAfter: { name: input.name, gstTreatment: input.gstTreatment },
    });
    return row!.id;
  });
}

/**
 * Changes a type's GST treatment (and an own type's name). Lines already
 * added keep the GST they were added with (rule 9).
 */
export async function updateChargeType(
  database: AnyDatabase,
  actor: ActingUser,
  chargeTypeId: string,
  input: Partial<ChargeTypeInput>,
): Promise<"saved" | "not_found"> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const [before] = await tx
      .select()
      .from(chargeTypes)
      .where(and(eq(chargeTypes.id, chargeTypeId), eq(chargeTypes.operatorId, actor.operatorId)));
    if (!before) {
      return "not_found";
    }
    const changes = {
      gstTreatment: input.gstTreatment ?? before.gstTreatment,
      // A built-in type's name comes from the app.
      name: before.builtIn ? null : (input.name ?? before.name),
      updatedAt: new Date(),
    };
    await tx.update(chargeTypes).set(changes).where(eq(chargeTypes.id, chargeTypeId));
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.chargeType,
      entityId: chargeTypeId,
      action: ACTIVITY_ACTIONS.updated,
      valuesBefore: { name: before.name, gstTreatment: before.gstTreatment },
      valuesAfter: { name: changes.name, gstTreatment: changes.gstTreatment },
    });
    return "saved";
  });
}

/** Archives one of the business's own types, or brings one back (review G4-4); built-in types stay. */
async function setChargeTypeArchived(
  database: AnyDatabase,
  actor: ActingUser,
  chargeTypeId: string,
  shouldArchive: boolean,
): Promise<"changed" | "not_found" | "built_in"> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const [row] = await tx
      .select()
      .from(chargeTypes)
      .where(and(eq(chargeTypes.id, chargeTypeId), eq(chargeTypes.operatorId, actor.operatorId)))
      .for(ROW_LOCK);
    if (!row || (row.archivedAt !== null) === shouldArchive) {
      return "not_found";
    }
    if (row.builtIn) {
      return "built_in";
    }
    const now = new Date();
    await tx
      .update(chargeTypes)
      .set({ archivedAt: shouldArchive ? now : null, updatedAt: now })
      .where(eq(chargeTypes.id, chargeTypeId));
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.chargeType,
      entityId: chargeTypeId,
      action: shouldArchive ? ACTIVITY_ACTIONS.archived : ACTIVITY_ACTIONS.restored,
    });
    return "changed";
  });
}

/** Stops one of the business's own types being used for new charges; lines keep it. */
export async function archiveChargeType(
  database: AnyDatabase,
  actor: ActingUser,
  chargeTypeId: string,
): Promise<"archived" | "not_found" | "built_in"> {
  const result = await setChargeTypeArchived(database, actor, chargeTypeId, true);
  return result === "changed" ? "archived" : result;
}

/** Brings back a type archived by mistake, for new charges again. */
export async function restoreChargeType(
  database: AnyDatabase,
  actor: ActingUser,
  chargeTypeId: string,
): Promise<"restored" | "not_found"> {
  const result = await setChargeTypeArchived(database, actor, chargeTypeId, false);
  return result === "changed" ? "restored" : "not_found";
}
