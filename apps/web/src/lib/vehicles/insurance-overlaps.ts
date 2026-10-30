import type { AnyTransaction } from "@fleetapp/db/client";
import { insurancePolicies, insurancePolicyVehicles, vehicles } from "@fleetapp/db/schema";
import { and, eq, gte, inArray, isNull, lte, ne, sql, type SQL } from "drizzle-orm";

/** The dates a policy covers, both days included. */
export interface CoverDates {
  startsOn: string;
  endsOn: string;
}

/** Another policy already covering one of the cars for some of the same days. */
export interface CoverOverlap {
  rego: string;
  insurer: string;
  endsOn: string;
}

/** Policies that are current and share at least one day with these dates. */
function overlapping(dates: CoverDates, exceptPolicyId: string | null): SQL | undefined {
  return and(
    isNull(insurancePolicies.archivedAt),
    lte(insurancePolicies.startsOn, dates.endsOn),
    gte(insurancePolicies.endsOn, dates.startsOn),
    exceptPolicyId ? ne(insurancePolicies.id, exceptPolicyId) : undefined,
  );
}

/**
 * Another current policy with the same number whose dates overlap: the same
 * policy entered twice. A renewal keeps its number but its dates follow on,
 * so it does not count. Numbers saved before they were kept in capitals are
 * compared in capitals too.
 */
export async function findSamePolicy(
  tx: AnyTransaction,
  operatorId: string,
  policy: CoverDates & { policyNumber: string },
  exceptPolicyId: string | null = null,
): Promise<string | null> {
  const [same] = await tx
    .select({ id: insurancePolicies.id })
    .from(insurancePolicies)
    .where(
      and(
        eq(insurancePolicies.operatorId, operatorId),
        eq(sql`upper(${insurancePolicies.policyNumber})`, policy.policyNumber.toUpperCase()),
        overlapping(policy, exceptPolicyId),
      ),
    )
    .limit(1);
  return same?.id ?? null;
}

/**
 * Cars already on another current policy for some of these dates. Saved
 * anyway, with a warning: cover can overlap for a few days on purpose, e.g.
 * when switching insurers.
 */
export async function findCoverOverlaps(
  tx: AnyTransaction,
  operatorId: string,
  vehicleIds: readonly string[],
  dates: CoverDates,
  exceptPolicyId: string | null,
): Promise<CoverOverlap[]> {
  if (vehicleIds.length === 0) {
    return [];
  }
  return tx
    .select({
      rego: vehicles.rego,
      insurer: insurancePolicies.insurer,
      endsOn: insurancePolicies.endsOn,
    })
    .from(insurancePolicyVehicles)
    .innerJoin(insurancePolicies, eq(insurancePolicies.id, insurancePolicyVehicles.policyId))
    .innerJoin(vehicles, eq(vehicles.id, insurancePolicyVehicles.vehicleId))
    .where(
      and(
        eq(insurancePolicyVehicles.operatorId, operatorId),
        inArray(insurancePolicyVehicles.vehicleId, [...vehicleIds]),
        isNull(insurancePolicyVehicles.removedAt),
        overlapping(dates, exceptPolicyId),
      ),
    );
}
