import type { InsuranceCoverType, ListPage, ListQuery } from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import {
  listConditions,
  listOrderBy,
  loadListPage,
  type DatabaseListRules,
} from "@fleetapp/db/list-query";
import {
  insurancePolicies,
  insurancePolicyVehicles,
  vehicleRegistrations,
  vehicles,
} from "@fleetapp/db/schema";
import { qualified } from "@fleetapp/db/qualified";
import { withTenant } from "@fleetapp/db/tenant-context";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  notExists,
  sql,
  type SQL,
} from "drizzle-orm";

export const POLICY_ARCHIVED_FILTER_VALUE = "archived";
export const POLICY_SHOW_FILTER_KEY = "show";

export type Registration = Omit<typeof vehicleRegistrations.$inferSelect, "operatorId">;
export type Policy = Omit<typeof insurancePolicies.$inferSelect, "operatorId">;

export interface VehiclePaperwork {
  /** Current renewals, latest expiry first. The first is the car's current rego. */
  registrations: Registration[];
  /** The policies the car is on now, latest ending first. */
  policies: Policy[];
}

/** A car's rego renewals and the policies it is on, within the signed-in User's Operator. */
export async function loadVehiclePaperwork(
  database: AnyDatabase,
  operatorId: string,
  vehicleId: string,
): Promise<VehiclePaperwork> {
  return withTenant(database, operatorId, async (tx) => {
    const [registrations, policyRows] = await Promise.all([
      tx
        .select()
        .from(vehicleRegistrations)
        .where(
          and(
            eq(vehicleRegistrations.operatorId, operatorId),
            eq(vehicleRegistrations.vehicleId, vehicleId),
            isNull(vehicleRegistrations.archivedAt),
          ),
        )
        .orderBy(desc(vehicleRegistrations.expiresOn)),
      tx
        .select({ policy: insurancePolicies })
        .from(insurancePolicyVehicles)
        .innerJoin(insurancePolicies, eq(insurancePolicies.id, insurancePolicyVehicles.policyId))
        .where(
          and(
            eq(insurancePolicyVehicles.operatorId, operatorId),
            eq(insurancePolicyVehicles.vehicleId, vehicleId),
            isNull(insurancePolicyVehicles.removedAt),
            isNull(insurancePolicies.archivedAt),
          ),
        )
        .orderBy(desc(insurancePolicies.endsOn)),
    ]);
    return { registrations, policies: policyRows.map((row) => row.policy) };
  });
}

/** Current policies, still running, that the car is not on yet: for "Put on an existing policy". */
export async function listPoliciesToJoin(
  database: AnyDatabase,
  operatorId: string,
  vehicleId: string,
  today: string,
): Promise<Policy[]> {
  return withTenant(database, operatorId, (tx) =>
    tx
      .select()
      .from(insurancePolicies)
      .where(
        and(
          eq(insurancePolicies.operatorId, operatorId),
          isNull(insurancePolicies.archivedAt),
          gte(insurancePolicies.endsOn, today),
          notExists(
            tx
              .select({ id: insurancePolicyVehicles.id })
              .from(insurancePolicyVehicles)
              .where(
                and(
                  eq(insurancePolicyVehicles.policyId, insurancePolicies.id),
                  eq(insurancePolicyVehicles.vehicleId, vehicleId),
                  isNull(insurancePolicyVehicles.removedAt),
                ),
              ),
          ),
        ),
      )
      .orderBy(asc(insurancePolicies.insurer), asc(insurancePolicies.policyNumber)),
  );
}

const coveredCarCount = sql<number>`(
  select count(*)::int from ${insurancePolicyVehicles}
  where ${qualified(insurancePolicyVehicles.policyId)} = ${qualified(insurancePolicies.id)}
    and ${qualified(insurancePolicyVehicles.removedAt)} is null
)`;

export interface PolicySummary {
  id: string;
  insurer: string;
  policyNumber: string;
  coverType: InsuranceCoverType;
  startsOn: string;
  endsOn: string;
  costCents: number;
  carCount: number;
  archivedAt: Date | null;
}

export const POLICY_LIST_RULES: DatabaseListRules = {
  searchIn: [insurancePolicies.insurer, insurancePolicies.policyNumber],
  sortBy: {
    insurer: sql`lower(${insurancePolicies.insurer})`,
    endsOn: insurancePolicies.endsOn,
    cars: coveredCarCount,
  },
  filterBy: { [POLICY_SHOW_FILTER_KEY]: () => undefined },
  tieBreaker: insurancePolicies.id,
};

function matchingPolicies(operatorId: string, query: ListQuery): SQL | undefined {
  const isArchivedShown = query.filters[POLICY_SHOW_FILTER_KEY] === POLICY_ARCHIVED_FILTER_VALUE;
  return and(
    eq(insurancePolicies.operatorId, operatorId),
    isArchivedShown
      ? isNotNull(insurancePolicies.archivedAt)
      : isNull(insurancePolicies.archivedAt),
    listConditions(POLICY_LIST_RULES, query),
  );
}

/** One page of the Operator's insurance policies. */
export async function listPolicyPage(
  database: AnyDatabase,
  operatorId: string,
  query: ListQuery,
): Promise<ListPage<PolicySummary>> {
  const where = matchingPolicies(operatorId, query);
  return withTenant(database, operatorId, (tx) =>
    loadListPage(query, {
      count: async () => {
        const [row] = await tx.select({ total: count() }).from(insurancePolicies).where(where);
        return row?.total ?? 0;
      },
      rows: ({ offset, limit }) =>
        tx
          .select({
            id: insurancePolicies.id,
            insurer: insurancePolicies.insurer,
            policyNumber: insurancePolicies.policyNumber,
            coverType: insurancePolicies.coverType,
            startsOn: insurancePolicies.startsOn,
            endsOn: insurancePolicies.endsOn,
            costCents: insurancePolicies.costCents,
            carCount: coveredCarCount,
            archivedAt: insurancePolicies.archivedAt,
          })
          .from(insurancePolicies)
          .where(where)
          .orderBy(...listOrderBy(POLICY_LIST_RULES, query))
          .limit(limit)
          .offset(offset),
    }),
  );
}

export interface CoveredCar {
  id: string;
  rego: string;
  regoState: string;
  make: string;
  model: string;
}

export interface PolicyDetail {
  policy: Policy;
  cars: CoveredCar[];
  /** The Operator's current cars not on this policy, for "Add a car". */
  otherCars: CoveredCar[];
}

const coveredCarColumns = {
  id: vehicles.id,
  rego: vehicles.rego,
  regoState: vehicles.regoState,
  make: vehicles.make,
  model: vehicles.model,
};

/** One of the Operator's policies with the cars it covers, or null if it is not theirs. */
export async function loadPolicy(
  database: AnyDatabase,
  operatorId: string,
  policyId: string,
): Promise<PolicyDetail | null> {
  return withTenant(database, operatorId, async (tx) => {
    const [policy] = await tx
      .select()
      .from(insurancePolicies)
      .where(and(eq(insurancePolicies.id, policyId), eq(insurancePolicies.operatorId, operatorId)));
    if (!policy) {
      return null;
    }
    const activeLink = and(
      eq(insurancePolicyVehicles.vehicleId, vehicles.id),
      eq(insurancePolicyVehicles.policyId, policyId),
      isNull(insurancePolicyVehicles.removedAt),
    );
    const [cars, otherCars] = await Promise.all([
      tx
        .select(coveredCarColumns)
        .from(vehicles)
        .innerJoin(insurancePolicyVehicles, activeLink)
        .where(eq(vehicles.operatorId, operatorId))
        .orderBy(asc(vehicles.rego)),
      tx
        .select(coveredCarColumns)
        .from(vehicles)
        .where(
          and(
            eq(vehicles.operatorId, operatorId),
            isNull(vehicles.archivedAt),
            notExists(
              tx
                .select({ id: insurancePolicyVehicles.id })
                .from(insurancePolicyVehicles)
                .where(activeLink),
            ),
          ),
        )
        .orderBy(asc(vehicles.rego)),
    ]);
    return { policy, cars, otherCars };
  });
}

/** Every rego renewal and policy a car has ever had, archived ones too: for its History tab. */
export async function loadPaperworkIds(
  database: AnyDatabase,
  operatorId: string,
  vehicleId: string,
): Promise<{ registrationIds: string[]; policyIds: string[] }> {
  return withTenant(database, operatorId, async (tx) => {
    const [registrations, links] = await Promise.all([
      tx
        .select({ id: vehicleRegistrations.id })
        .from(vehicleRegistrations)
        .where(
          and(
            eq(vehicleRegistrations.operatorId, operatorId),
            eq(vehicleRegistrations.vehicleId, vehicleId),
          ),
        ),
      tx
        .selectDistinct({ id: insurancePolicyVehicles.policyId })
        .from(insurancePolicyVehicles)
        .where(
          and(
            eq(insurancePolicyVehicles.operatorId, operatorId),
            eq(insurancePolicyVehicles.vehicleId, vehicleId),
          ),
        ),
    ]);
    return {
      registrationIds: registrations.map((row) => row.id),
      policyIds: links.map((row) => row.id),
    };
  });
}

/** The Operator's current cars, for ticking on a new fleet policy. */
export async function listCarChoices(
  database: AnyDatabase,
  operatorId: string,
): Promise<CoveredCar[]> {
  return withTenant(database, operatorId, (tx) =>
    tx
      .select(coveredCarColumns)
      .from(vehicles)
      .where(and(eq(vehicles.operatorId, operatorId), isNull(vehicles.archivedAt)))
      .orderBy(asc(vehicles.rego)),
  );
}
