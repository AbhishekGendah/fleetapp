import {
  bondHeldCents,
  CLAIM_STATUSES_UNDER_WAY,
  describeErrorForLog,
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
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { findDueOperators, forEachOperator } from "../jobs/due-operators";

/** At most this many Renters retired per business per night; the next night carries on. */
const RENTERS_PER_RUN = 50;
/** A draft, a booking or a car out: the database's own check says the same. */
const OPEN_RENTAL_STATUSES = ["draft", "booked", "active"] as const;

export interface RenterRetirementSummary {
  operators: number;
  retiredRenters: number;
  failedOperators: number;
  unreachedOperators: number;
}

const answerSchema = z.object({ rows: z.array(z.object({ answer: z.boolean() })) });

async function askDatabase(tx: AnyTransaction, query: ReturnType<typeof sql>): Promise<boolean> {
  return answerSchema.parse(await tx.execute(query)).rows[0]?.answer === true;
}

/**
 * Renters whose seven years are up by the database's own count, with no
 * draft, booking or car out: every one, in a fixed order, so Renters held
 * back by money or damage never crowd out the rest.
 */
async function findCandidates(tx: AnyTransaction, operatorId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: renters.id })
    .from(renters)
    .where(
      and(
        eq(renters.operatorId, operatorId),
        isNull(renters.retiredAt),
        sql`app.renter_records_kept_until(${renters.id}) <= now()`,
        sql`not exists (select 1 from ${rentals} where ${rentals.renterId} = ${renters.id} and ${inArray(rentals.status, [...OPEN_RENTAL_STATUSES])})`,
      ),
    )
    .orderBy(asc(renters.id));
  return rows.map((row) => row.id);
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

/**
 * One Renter, in their own transaction: locked first, so a payment, bond or
 * damage record landing meanwhile is seen; then checked; then retired, with
 * its history line. True if retired.
 */
async function retireOne(
  database: AnyDatabase,
  operatorId: string,
  renterId: string,
): Promise<boolean> {
  return withTenant(database, operatorId, async (tx) => {
    const isLocked = await askDatabase(
      tx,
      sql`select app.lock_renter_for_retirement(${renterId}) as answer`,
    );
    if (!isLocked || (await isAnythingOpen(tx, operatorId, renterId))) {
      return false;
    }
    if (!(await askDatabase(tx, sql`select app.retire_renter(${renterId}) as answer`))) {
      return false;
    }
    await recordActivity(tx, {
      operatorId,
      actor: { type: "system", id: null },
      entityType: ACTIVITY_ENTITY_TYPES.renter,
      entityId: renterId,
      action: ACTIVITY_ACTIONS.purged,
      valuesAfter: { reason: "kept_seven_years" },
    });
    return true;
  });
}

/**
 * One business's Renters whose time is up. Each is done on its own, so one
 * that fails is logged (its type only) and the rest carry on; the run stops
 * at the limit or when its time is spent, and the next night carries on.
 */
async function retireForOperator(
  database: AnyDatabase,
  operatorId: string,
  isOutOfTime: () => boolean,
): Promise<number> {
  const candidates = await withTenant(database, operatorId, (tx) => findCandidates(tx, operatorId));
  let retired = 0;
  for (const renterId of candidates) {
    if (retired >= RENTERS_PER_RUN || isOutOfTime()) {
      break;
    }
    try {
      retired += (await retireOne(database, operatorId, renterId)) ? 1 : 0;
    } catch (error) {
      console.error("Retiring a Renter failed", describeErrorForLog(error));
    }
  }
  return retired;
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
    (operatorId) => retireForOperator(database, operatorId, isOutOfTime),
    isOutOfTime,
  );
  return {
    operators: run.operators,
    retiredRenters: run.done,
    failedOperators: run.failedOperators,
    unreachedOperators: run.unreachedOperators,
  };
}
