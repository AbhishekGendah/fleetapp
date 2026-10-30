import { changedValues, hasChanges } from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  insurancePolicies,
  insurancePolicyVehicles,
  type ActivityAction,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, isNull } from "drizzle-orm";

import { recordUserChange, type ActingUser, type UserChange } from "../acting-user";
import { findCurrentVehicle } from "./current-vehicle";
import { findCoverOverlaps, findSamePolicy, type CoverOverlap } from "./insurance-overlaps";
import { POLICY_FORM_FIELDS, type PolicyInput } from "./paperwork-input";

export type PolicyChangeResult = "changed" | "unchanged" | "not_found";

export type CreatePolicyResult =
  | { status: "created"; policyId: string; overlaps: CoverOverlap[] }
  | { status: "duplicate"; policyId: string }
  | { status: "not_found" };

export type AddVehicleResult =
  | { status: "added"; overlaps: CoverOverlap[] }
  | { status: "already_on" }
  | { status: "not_found" };

function logPolicyChange(
  tx: AnyTransaction,
  actor: ActingUser,
  policyId: string,
  action: ActivityAction,
  values: Pick<UserChange, "valuesBefore" | "valuesAfter"> = {},
): Promise<void> {
  return recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.insurancePolicy,
    entityId: policyId,
    action,
    ...values,
  });
}

/** The Operator's policy, locked for this transaction, if it is not archived. */
async function lockCurrentPolicy(tx: AnyTransaction, operatorId: string, policyId: string) {
  const [policy] = await tx
    .select()
    .from(insurancePolicies)
    .where(
      and(
        eq(insurancePolicies.id, policyId),
        eq(insurancePolicies.operatorId, operatorId),
        isNull(insurancePolicies.archivedAt),
      ),
    )
    .for("update");
  return policy;
}

/** Puts a car on a policy, unless it is already on it. Both must be the Operator's. */
async function linkVehicle(
  tx: AnyTransaction,
  actor: ActingUser,
  policyId: string,
  vehicleId: string,
): Promise<"added" | "already_on" | "not_found"> {
  if (!(await findCurrentVehicle(tx, actor.operatorId, vehicleId))) {
    return "not_found";
  }
  const [linked] = await tx
    .insert(insurancePolicyVehicles)
    .values({ operatorId: actor.operatorId, policyId, vehicleId })
    .onConflictDoNothing()
    .returning({ id: insurancePolicyVehicles.id });
  if (!linked) {
    return "already_on";
  }
  await logPolicyChange(tx, actor, policyId, ACTIVITY_ACTIONS.vehicleAdded, {
    valuesAfter: { vehicleId },
  });
  return "added";
}

class VehicleNotFoundError extends Error {
  constructor() {
    super("A car for the policy is not one of the Operator's current cars.");
    this.name = "VehicleNotFoundError";
  }
}

/**
 * Adds a policy covering the given cars: usually one, from that car's page;
 * several for a fleet policy. Nothing is saved if any car is not the
 * Operator's current car.
 */
export async function createPolicy(
  database: AnyDatabase,
  actor: ActingUser,
  input: PolicyInput,
  vehicleIds: readonly string[],
): Promise<CreatePolicyResult> {
  return withTenant(database, actor.operatorId, async (tx): Promise<CreatePolicyResult> => {
    const samePolicyId = await findSamePolicy(tx, actor.operatorId, input);
    if (samePolicyId) {
      return { status: "duplicate", policyId: samePolicyId };
    }
    const [policy] = await tx
      .insert(insurancePolicies)
      .values({ ...input, operatorId: actor.operatorId })
      .returning({ id: insurancePolicies.id });
    if (!policy) {
      throw new Error("The policy was not saved.");
    }
    await logPolicyChange(tx, actor, policy.id, ACTIVITY_ACTIONS.created, { valuesAfter: input });
    for (const vehicleId of new Set(vehicleIds)) {
      if ((await linkVehicle(tx, actor, policy.id, vehicleId)) === "not_found") {
        // Undoes the whole transaction, policy included.
        throw new VehicleNotFoundError();
      }
    }
    const overlaps = await findCoverOverlaps(
      tx,
      actor.operatorId,
      [...new Set(vehicleIds)],
      input,
      policy.id,
    );
    return { status: "created", policyId: policy.id, overlaps };
  }).catch((error: unknown) => {
    if (error instanceof VehicleNotFoundError) {
      return { status: "not_found" as const };
    }
    throw error;
  });
}

/** Saves the policy's details, logging only what changed. */
export async function updatePolicy(
  database: AnyDatabase,
  actor: ActingUser,
  policyId: string,
  input: PolicyInput,
): Promise<PolicyChangeResult | "duplicate"> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const before = await lockCurrentPolicy(tx, actor.operatorId, policyId);
    if (!before) {
      return "not_found";
    }
    if (await findSamePolicy(tx, actor.operatorId, input, policyId)) {
      return "duplicate";
    }
    const changes = changedValues(before, input, POLICY_FORM_FIELDS);
    if (!hasChanges(changes)) {
      return "unchanged";
    }
    await tx.update(insurancePolicies).set(input).where(eq(insurancePolicies.id, policyId));
    await logPolicyChange(tx, actor, policyId, ACTIVITY_ACTIONS.updated, changes);
    return "changed";
  });
}

/** Hides a policy entered by mistake or long finished. Its history is kept (rule 13). */
export async function archivePolicy(
  database: AnyDatabase,
  actor: ActingUser,
  policyId: string,
): Promise<PolicyChangeResult> {
  return withTenant(database, actor.operatorId, async (tx) => {
    if (!(await lockCurrentPolicy(tx, actor.operatorId, policyId))) {
      return "not_found";
    }
    await tx
      .update(insurancePolicies)
      .set({ archivedAt: new Date() })
      .where(eq(insurancePolicies.id, policyId));
    await logPolicyChange(tx, actor, policyId, ACTIVITY_ACTIONS.archived);
    return "changed";
  });
}

/** Puts one of the Operator's cars on one of its current policies. */
export async function addVehicleToPolicy(
  database: AnyDatabase,
  actor: ActingUser,
  policyId: string,
  vehicleId: string,
): Promise<AddVehicleResult> {
  return withTenant(database, actor.operatorId, async (tx): Promise<AddVehicleResult> => {
    const policy = await lockCurrentPolicy(tx, actor.operatorId, policyId);
    if (!policy) {
      return { status: "not_found" };
    }
    const linked = await linkVehicle(tx, actor, policyId, vehicleId);
    if (linked !== "added") {
      return { status: linked };
    }
    const overlaps = await findCoverOverlaps(tx, actor.operatorId, [vehicleId], policy, policyId);
    return { status: "added", overlaps };
  });
}

/** Takes a car off a policy. The link is closed, not deleted, so history shows when. */
export async function removeVehicleFromPolicy(
  database: AnyDatabase,
  actor: ActingUser,
  policyId: string,
  vehicleId: string,
): Promise<"removed" | "not_found"> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const [removed] = await tx
      .update(insurancePolicyVehicles)
      .set({ removedAt: new Date() })
      .where(
        and(
          eq(insurancePolicyVehicles.policyId, policyId),
          eq(insurancePolicyVehicles.vehicleId, vehicleId),
          eq(insurancePolicyVehicles.operatorId, actor.operatorId),
          isNull(insurancePolicyVehicles.removedAt),
        ),
      )
      .returning({ id: insurancePolicyVehicles.id });
    if (!removed) {
      return "not_found";
    }
    await logPolicyChange(tx, actor, policyId, ACTIVITY_ACTIONS.vehicleRemoved, {
      valuesAfter: { vehicleId },
    });
    return "removed";
  });
}
