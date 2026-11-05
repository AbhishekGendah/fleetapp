import {
  bondHeldCents,
  CLAIM_STATUSES_UNDER_WAY,
  isAnythingStillOpen,
  ledgerBalanceCents,
} from "@fleetapp/core";
import { recordActivity } from "@fleetapp/db/activity";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  bondMovements,
  damageRecords,
  insuranceClaims,
  ledgerLines,
  rentals,
  renters,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { findDueOperators, forEachOperator } from "../jobs/due-operators";

/** At most this many Renters per business per night; the next night carries on. */
const RENTERS_PER_RUN = 50;
const OPEN_RENTAL_STATUSES = ["booked", "active"] as const;

export interface RenterRetirementSummary {
  operators: number;
  retiredRenters: number;
  failedOperators: number;
  unreachedOperators: number;
}

const retiredSchema = z.object({ rows: z.array(z.object({ retired: z.boolean() })) });

/** Renters whose seven years are up by the database's own count, with no booking or car out. */
async function findCandidates(
  tx: AnyTransaction,
  operatorId: string,
): Promise<{ id: string; addedAt: Date }[]> {
  return tx
    .select({ id: renters.id, addedAt: renters.createdAt })
    .from(renters)
    .where(
      and(
        eq(renters.operatorId, operatorId),
        isNull(renters.retiredAt),
        sql`app.renter_records_kept_until(${renters.id}) <= now()`,
        sql`not exists (select 1 from ${rentals} where ${rentals.renterId} = ${renters.id} and ${inArray(rentals.status, [...OPEN_RENTAL_STATUSES])})`,
      ),
    )
    .limit(RENTERS_PER_RUN);
}

/**
 * What still ties the Renter to the business: money either way, a bond, a
 * damage matter. The dates and open rentals were checked by the database.
 */
async function isAnythingOpen(
  tx: AnyTransaction,
  operatorId: string,
  renterId: string,
): Promise<boolean> {
  const own = await tx
    .select({ id: rentals.id })
    .from(rentals)
    .where(and(eq(rentals.operatorId, operatorId), eq(rentals.renterId, renterId)));
  const rentalIds = own.map((rental) => rental.id);
  const [lines, bond, openDamage] = await Promise.all([
    rentalIds.length === 0
      ? []
      : tx
          .select({
            id: ledgerLines.id,
            kind: ledgerLines.kind,
            amountCents: ledgerLines.amountCents,
            reversesId: ledgerLines.reversesId,
          })
          .from(ledgerLines)
          .where(
            and(eq(ledgerLines.operatorId, operatorId), inArray(ledgerLines.rentalId, rentalIds)),
          ),
    rentalIds.length === 0
      ? []
      : tx
          .select({
            id: bondMovements.id,
            kind: bondMovements.kind,
            amountCents: bondMovements.amountCents,
            reversesId: bondMovements.reversesId,
          })
          .from(bondMovements)
          .where(
            and(
              eq(bondMovements.operatorId, operatorId),
              inArray(bondMovements.rentalId, rentalIds),
            ),
          ),
    tx
      .select({ id: damageRecords.id })
      .from(damageRecords)
      .leftJoin(insuranceClaims, eq(insuranceClaims.damageRecordId, damageRecords.id))
      .where(
        and(
          eq(damageRecords.operatorId, operatorId),
          eq(damageRecords.renterId, renterId),
          or(
            eq(damageRecords.status, "open"),
            inArray(insuranceClaims.status, [...CLAIM_STATUSES_UNDER_WAY]),
          ),
        ),
      )
      .limit(1),
  ]);
  return isAnythingStillOpen({
    hasOpenRental: false,
    balanceCents: ledgerBalanceCents(lines),
    bondHeldCents: bondHeldCents(bond),
    hasOpenDamageMatter: openDamage.length > 0,
  });
}

/** One business's Renters whose time is up, retired one by one, each with its history line. */
async function retireForOperator(database: AnyDatabase, operatorId: string): Promise<number> {
  return withTenant(database, operatorId, async (tx) => {
    let retired = 0;
    for (const candidate of await findCandidates(tx, operatorId)) {
      if (await isAnythingOpen(tx, operatorId, candidate.id)) {
        continue;
      }
      const result = retiredSchema.parse(
        await tx.execute(sql`select app.retire_renter(${candidate.id}) as retired`),
      );
      if (result.rows[0]?.retired) {
        retired += 1;
        await recordActivity(tx, {
          operatorId,
          actor: { type: "system", id: null },
          entityType: ACTIVITY_ENTITY_TYPES.renter,
          entityId: candidate.id,
          action: ACTIVITY_ACTIONS.purged,
          valuesAfter: { reason: "kept_seven_years" },
        });
      }
    }
    return retired;
  });
}

/**
 * Part of the nightly clean-up (review G8-4): seven years after a Renter's
 * last rental ended, with nothing still open, their personal details are
 * removed and their signed PDFs and photos binned (gone for good 30 days
 * later). Money lines, invoices and the history stay, so the books still add
 * up. One business at a time, each in its own tenant context (rule 3). Safe
 * to run again (rule 20).
 */
export async function retireOldRenters(
  database: AnyDatabase,
  isOutOfTime: () => boolean = () => false,
): Promise<RenterRetirementSummary> {
  const operatorIds = await findDueOperators(
    database,
    sql`select operator_id from app.operators_with_renters_to_retire(now()) as operator_id`,
  );
  const run = await forEachOperator(
    operatorIds,
    "Renter record retention",
    (operatorId) => retireForOperator(database, operatorId),
    isOutOfTime,
  );
  return {
    operators: run.operators,
    retiredRenters: run.done,
    failedOperators: run.failedOperators,
    unreachedOperators: run.unreachedOperators,
  };
}
