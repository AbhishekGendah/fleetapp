import {
  addDays,
  CLAIM_STATUSES_UNDER_WAY,
  startOfDayIn,
  type ClaimStatus,
  type DamageStatus,
} from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  damageRecords,
  files,
  insurancePolicies,
  insurancePolicyVehicles,
  insuranceClaims,
  possessions,
  renters,
  vehicles,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";

import { listCarPhotos, type CarPhoto } from "../files/car-files";
import type { FileDependencies } from "../files/stored-files";

export interface DamageSummary {
  id: string;
  vehicleId: string;
  foundOn: string;
  description: string;
  status: DamageStatus;
  renterFullName: string | null;
  claimStatus: ClaimStatus | null;
  isFromReturn: boolean;
}

const SUMMARY_COLUMNS = {
  id: damageRecords.id,
  vehicleId: damageRecords.vehicleId,
  foundOn: damageRecords.foundOn,
  description: damageRecords.description,
  status: damageRecords.status,
  renterFullName: renters.fullName,
  claimStatus: insuranceClaims.status,
  isFromReturn: sql<boolean>`${damageRecords.damageMarkId} is not null`,
};

/** Damage records matching, open ones first, then newest found. */
function listDamage(tx: AnyTransaction, operatorId: string, where: SQL | undefined) {
  return tx
    .select(SUMMARY_COLUMNS)
    .from(damageRecords)
    .leftJoin(
      renters,
      and(eq(renters.id, damageRecords.renterId), eq(renters.operatorId, damageRecords.operatorId)),
    )
    .leftJoin(
      insuranceClaims,
      and(
        eq(insuranceClaims.damageRecordId, damageRecords.id),
        eq(insuranceClaims.operatorId, damageRecords.operatorId),
      ),
    )
    .where(and(eq(damageRecords.operatorId, operatorId), isNull(damageRecords.archivedAt), where))
    .orderBy(
      sql`${damageRecords.status} <> 'open'`,
      desc(damageRecords.foundOn),
      desc(damageRecords.createdAt),
    );
}

/** A car's Damage tab. */
export function listCarDamage(
  database: AnyDatabase,
  operatorId: string,
  vehicleId: string,
): Promise<DamageSummary[]> {
  return withTenant(database, operatorId, (tx) =>
    listDamage(tx, operatorId, eq(damageRecords.vehicleId, vehicleId)),
  );
}

/** A rental's Damage card: what was found under it (at its return or later). */
export function listRentalDamage(
  database: AnyDatabase,
  operatorId: string,
  rentalId: string,
): Promise<DamageSummary[]> {
  return withTenant(database, operatorId, (tx) =>
    listDamage(tx, operatorId, eq(damageRecords.rentalId, rentalId)),
  );
}

export type DamageRecord = Omit<typeof damageRecords.$inferSelect, "operatorId">;
export type InsuranceClaim = Omit<typeof insuranceClaims.$inferSelect, "operatorId">;

export interface DamageDetail {
  record: DamageRecord;
  car: { rego: string; make: string; model: string };
  renterFullName: string | null;
  claim: InsuranceClaim | null;
  /** The policy's insurer and number for the claim, readable even if it is archived. */
  claimPolicy: { insurer: string; policyNumber: string } | null;
  /** Its own photos, and the return's photo of its mark. */
  photos: CarPhoto[];
  /** Who had the car that day, when nobody is recorded yet (rule 15). */
  suggestedHolder: CarHolder | null;
}

async function loadDamageRow(database: AnyDatabase, operatorId: string, damageId: string) {
  return withTenant(database, operatorId, async (tx) => {
    const [row] = await tx
      .select({
        record: damageRecords,
        car: { rego: vehicles.rego, make: vehicles.make, model: vehicles.model },
        renterFullName: renters.fullName,
      })
      .from(damageRecords)
      .innerJoin(
        vehicles,
        and(
          eq(vehicles.id, damageRecords.vehicleId),
          eq(vehicles.operatorId, damageRecords.operatorId),
        ),
      )
      .leftJoin(
        renters,
        and(
          eq(renters.id, damageRecords.renterId),
          eq(renters.operatorId, damageRecords.operatorId),
        ),
      )
      .where(
        and(
          eq(damageRecords.id, damageId),
          eq(damageRecords.operatorId, operatorId),
          isNull(damageRecords.archivedAt),
        ),
      );
    if (!row) {
      return null;
    }
    const [claimRow] = await tx
      .select({
        claim: insuranceClaims,
        policy: {
          insurer: insurancePolicies.insurer,
          policyNumber: insurancePolicies.policyNumber,
        },
      })
      .from(insuranceClaims)
      .leftJoin(
        insurancePolicies,
        and(
          eq(insurancePolicies.id, insuranceClaims.policyId),
          eq(insurancePolicies.operatorId, insuranceClaims.operatorId),
        ),
      )
      .where(
        and(
          eq(insuranceClaims.operatorId, operatorId),
          eq(insuranceClaims.damageRecordId, damageId),
        ),
      );
    return { ...row, claimRow: claimRow ?? null };
  });
}

function withoutOperator<Row extends { operatorId: string }>(row: Row): Omit<Row, "operatorId"> {
  const { operatorId: _operatorId, ...rest } = row;
  return rest;
}

/** The damage record page: null if it is not this business's, or archived. */
export async function loadDamageDetail(
  deps: Pick<FileDependencies, "database" | "storage">,
  operatorId: string,
  request: { damageId: string; timeZone: string },
): Promise<DamageDetail | null> {
  const row = await loadDamageRow(deps.database, operatorId, request.damageId);
  if (!row) {
    return null;
  }
  const { record } = row;
  const photos = await listCarPhotos(
    deps,
    operatorId,
    record.vehicleId,
    or(
      eq(files.damageRecordId, record.id),
      record.damageMarkId ? eq(files.damageMarkId, record.damageMarkId) : undefined,
    ),
  );
  const suggestedHolder = record.renterId
    ? null
    : await whoHadCar(deps.database, operatorId, {
        vehicleId: record.vehicleId,
        day: record.foundOn,
        timeZone: request.timeZone,
      });
  return {
    record: withoutOperator(record),
    car: row.car,
    renterFullName: row.renterFullName,
    claim: row.claimRow ? withoutOperator(row.claimRow.claim) : null,
    claimPolicy: row.claimRow?.policy ?? null,
    photos,
    suggestedHolder,
  };
}

export interface ClaimDefaults {
  policyId: string;
  insurer: string;
  excessCents: number | null;
}

/**
 * The policy covering the car on the day the damage was found, to start a
 * claim from: its insurer and excess. The latest-starting one if two
 * overlapped; null if the car had none (insurer is then typed in).
 */
export async function loadClaimDefaults(
  database: AnyDatabase,
  operatorId: string,
  request: { vehicleId: string; foundOn: string; timeZone: string },
): Promise<ClaimDefaults | null> {
  const localDate = (moment: SQL | AnyColumn): SQL =>
    sql`(${moment} at time zone ${request.timeZone})::date`;
  const [policy] = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        policyId: insurancePolicies.id,
        insurer: insurancePolicies.insurer,
        excessCents: insurancePolicies.excessCents,
      })
      .from(insurancePolicyVehicles)
      .innerJoin(
        insurancePolicies,
        and(
          eq(insurancePolicies.id, insurancePolicyVehicles.policyId),
          eq(insurancePolicies.operatorId, insurancePolicyVehicles.operatorId),
        ),
      )
      .where(
        and(
          eq(insurancePolicyVehicles.operatorId, operatorId),
          eq(insurancePolicyVehicles.vehicleId, request.vehicleId),
          lte(insurancePolicies.startsOn, request.foundOn),
          gte(insurancePolicies.endsOn, request.foundOn),
          lte(localDate(insurancePolicyVehicles.addedAt), request.foundOn),
          or(
            isNull(insurancePolicyVehicles.removedAt),
            gte(localDate(insurancePolicyVehicles.removedAt), request.foundOn),
          ),
        ),
      )
      .orderBy(desc(insurancePolicies.startsOn), asc(insurancePolicies.id))
      .limit(1),
  );
  return policy ?? null;
}

export interface CarHolder {
  rentalId: string;
  renterId: string;
  renterFullName: string;
}

/**
 * Who had the car on a day (rule 15): the possession covering any part of
 * it, the latest if two did (a return and a new handover the same day).
 * Only a suggestion: the Operator confirms it.
 */
export async function whoHadCar(
  database: AnyDatabase,
  operatorId: string,
  request: { vehicleId: string; day: string; timeZone: string },
): Promise<CarHolder | null> {
  const dayStarts = startOfDayIn(request.day, request.timeZone);
  const dayEnds = startOfDayIn(addDays(request.day, 1), request.timeZone);
  const [holder] = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        rentalId: possessions.rentalId,
        renterId: possessions.renterId,
        renterFullName: renters.fullName,
      })
      .from(possessions)
      .innerJoin(
        renters,
        and(eq(renters.id, possessions.renterId), eq(renters.operatorId, possessions.operatorId)),
      )
      .where(
        and(
          eq(possessions.operatorId, operatorId),
          eq(possessions.vehicleId, request.vehicleId),
          lt(possessions.startedAt, dayEnds),
          or(isNull(possessions.endedAt), gt(possessions.endedAt, dayStarts)),
        ),
      )
      .orderBy(desc(possessions.startedAt))
      .limit(1),
  );
  return holder ?? null;
}

export interface DamageAttention {
  openDamage: number;
  claimsUnderWay: number;
}

/** The dashboard's "Damage open" and "Claims under way" lines. */
export function countDamageAttention(
  database: AnyDatabase,
  operatorId: string,
): Promise<DamageAttention> {
  return withTenant(database, operatorId, async (tx) => {
    const [open] = await tx
      .select({ total: count() })
      .from(damageRecords)
      .where(
        and(
          eq(damageRecords.operatorId, operatorId),
          eq(damageRecords.status, "open"),
          isNull(damageRecords.archivedAt),
        ),
      );
    const [claims] = await tx
      .select({ total: count() })
      .from(insuranceClaims)
      .innerJoin(
        damageRecords,
        and(
          eq(damageRecords.id, insuranceClaims.damageRecordId),
          eq(damageRecords.operatorId, insuranceClaims.operatorId),
        ),
      )
      .where(
        and(
          eq(insuranceClaims.operatorId, operatorId),
          inArray(insuranceClaims.status, [...CLAIM_STATUSES_UNDER_WAY]),
          isNull(damageRecords.archivedAt),
        ),
      );
    return { openDamage: open?.total ?? 0, claimsUnderWay: claims?.total ?? 0 };
  });
}
