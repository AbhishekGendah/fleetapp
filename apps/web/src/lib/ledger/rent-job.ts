import {
  addDays,
  describeErrorForLog,
  dueRentPeriods,
  formatCalendarDate,
  gstForLine,
  isGstRegisteredOn,
  MILLISECONDS_PER_DAY,
  operatorSettingsSchema,
  readSettings,
  rentForPeriod,
  todayInTimeZone,
  unusedDaysCredit,
  type RateFromDate,
  type RentPeriod,
  type Weekday,
} from "@fleetapp/core";
import { recordActivity } from "@fleetapp/db/activity";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  ledgerLines,
  rentalRates,
  rentals,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";

import type { BillingDependencies } from "../billing/billing-context";
import { issuePendingDocumentsQuietly } from "../billing/billing-run";
import { findDueOperators, forEachOperator, type OperatorRun } from "../jobs/due-operators";
import { builtInChargeType, type ChargeType } from "./charge-types";
import { loadOperatorGst, type OperatorGst } from "./operator-gst";

const SYSTEM_ACTOR = { type: "system", id: null } as const;
/**
 * A returned rental is looked at for this long after the return, so its
 * unused-days credit is added even if the job missed days around it.
 */
const RETURNED_LOOKBACK_DAYS = 60;

export interface RentAdded {
  charged: number;
  credited: number;
}

interface RentalToCharge {
  id: string;
  handedOverAt: Date;
  returnedAt: Date | null;
  chargeWeekday: number;
  settingsSnapshot: Record<string, unknown>;
}

interface RentContext {
  operatorId: string;
  gst: OperatorGst;
  today: string;
  weeklyRent: ChargeType;
  partWeekRent: ChargeType;
}

function periodText(period: RentPeriod): string {
  return `${formatCalendarDate(period.start)} to ${formatCalendarDate(addDays(period.end, -1))}`;
}

/** Adds a line unless its period's line is there already (rule 20); true when added. */
async function addRentLine(
  tx: AnyTransaction,
  context: RentContext,
  line: Omit<typeof ledgerLines.$inferInsert, "operatorId" | "gstCents"> & {
    chargeType: ChargeType;
    periodStart: string;
  },
): Promise<boolean> {
  const { chargeType, ...values } = line;
  const gstCents = gstForLine(
    values.amountCents,
    chargeType.gstTreatment,
    isGstRegisteredOn(context.gst.registeredFrom, values.periodStart),
  );
  const [added] = await tx
    .insert(ledgerLines)
    .values({ ...values, operatorId: context.operatorId, chargeTypeId: chargeType.id, gstCents })
    .onConflictDoNothing()
    .returning({ id: ledgerLines.id });
  if (!added) {
    return false;
  }
  await recordActivity(tx, {
    operatorId: context.operatorId,
    actor: SYSTEM_ACTOR,
    entityType: ACTIVITY_ENTITY_TYPES.ledgerLine,
    entityId: added.id,
    action: ACTIVITY_ACTIONS.created,
    valuesAfter: { kind: values.kind, amountCents: values.amountCents, gstCents },
  });
  return true;
}

/** One rental's rent due by today, and the credit for unused days once the car is back. */
async function chargeRental(
  tx: AnyTransaction,
  context: RentContext,
  rental: RentalToCharge,
): Promise<RentAdded> {
  const rows = await tx
    .select({ appliesFrom: rentalRates.appliesFrom, weeklyRateCents: rentalRates.weeklyRateCents })
    .from(rentalRates)
    .where(
      and(eq(rentalRates.operatorId, context.operatorId), eq(rentalRates.rentalId, rental.id)),
    );
  // TODO(batch 1): this weekday engine is replaced by block rent; it reads weekday rates only.
  const rates: RateFromDate[] = rows.flatMap(({ appliesFrom, weeklyRateCents }) =>
    appliesFrom !== null && weeklyRateCents !== null ? [{ appliesFrom, weeklyRateCents }] : [],
  );
  const { partWeekCharging } = readSettings(operatorSettingsSchema, rental.settingsSnapshot);
  const timeZone = context.gst.timeZone;
  const returnDate = rental.returnedAt ? todayInTimeZone(rental.returnedAt, timeZone) : null;
  const periods = dueRentPeriods({
    handoverDate: todayInTimeZone(rental.handedOverAt, timeZone),
    chargeWeekday: rental.chargeWeekday as Weekday,
    today: context.today,
    returnDate,
  });
  const added: RentAdded = { charged: 0, credited: 0 };
  for (const period of periods) {
    const chargeType = period.isPartWeek ? context.partWeekRent : context.weeklyRent;
    const isCharged = await addRentLine(tx, context, {
      rentalId: rental.id,
      kind: "charge",
      chargeType,
      amountCents: rentForPeriod(rates, period, partWeekCharging),
      description: `Rent ${periodText(period)}${period.isPartWeek ? " (part week)" : ""}`,
      effectiveOn: period.start,
      periodStart: period.start,
      periodEnd: period.end,
    });
    added.charged += isCharged ? 1 : 0;
    const credit = returnDate ? unusedDaysCredit(rates, period, returnDate, partWeekCharging) : 0;
    if (returnDate && credit > 0) {
      const unused = { ...period, start: addDays(returnDate, 1) };
      const isCredited = await addRentLine(tx, context, {
        rentalId: rental.id,
        kind: "credit",
        chargeType,
        amountCents: credit,
        description: `Unused days ${periodText(unused)}: the car came back on ${formatCalendarDate(returnDate)}`,
        effectiveOn: returnDate,
        periodStart: period.start,
        periodEnd: period.end,
      });
      added.credited += isCredited ? 1 : 0;
    }
  }
  return added;
}

/**
 * Adds the rent due for one business's rentals (or only the ones given):
 * every period that has started and is not charged yet, and each returned
 * rental's unused-days credit. Running it again adds nothing (rule 20).
 */
export async function chargeRentFor(
  database: AnyDatabase,
  operatorId: string,
  now: Date,
  onlyRentalIds?: readonly string[],
): Promise<RentAdded> {
  return withTenant(database, operatorId, async (tx) => {
    const gst = await loadOperatorGst(tx, operatorId);
    const context: RentContext = {
      operatorId,
      gst,
      today: todayInTimeZone(now, gst.timeZone),
      weeklyRent: await builtInChargeType(tx, operatorId, "weekly_rent"),
      partWeekRent: await builtInChargeType(tx, operatorId, "part_week_rent"),
    };
    const returnedSince = new Date(now.getTime() - RETURNED_LOOKBACK_DAYS * MILLISECONDS_PER_DAY);
    const due = await tx
      .select({
        id: rentals.id,
        handedOverAt: rentals.handedOverAt,
        returnedAt: rentals.returnedAt,
        chargeWeekday: rentals.chargeWeekday,
        settingsSnapshot: rentals.settingsSnapshot,
      })
      .from(rentals)
      .where(
        and(
          eq(rentals.operatorId, operatorId),
          isNotNull(rentals.handedOverAt),
          or(
            eq(rentals.status, "active"),
            and(
              inArray(rentals.status, ["returned", "closed"]),
              gte(rentals.returnedAt, returnedSince),
            ),
          ),
          onlyRentalIds ? inArray(rentals.id, [...onlyRentalIds]) : undefined,
        ),
      );
    const total: RentAdded = { charged: 0, credited: 0 };
    for (const rental of due) {
      const added = await chargeRental(tx, context, {
        ...rental,
        handedOverAt: rental.handedOverAt!,
      });
      total.charged += added.charged;
      total.credited += added.credited;
    }
    return total;
  });
}

/**
 * The daily rent run (docs/design/06): asks which businesses have rent due
 * (the one place ids cross businesses, rule 3), then charges each in its own
 * tenant context. One business failing never stops the others.
 */
export async function runRentJob(database: AnyDatabase, now: Date): Promise<OperatorRun> {
  const returnedSince = new Date(now.getTime() - RETURNED_LOOKBACK_DAYS * MILLISECONDS_PER_DAY);
  const operatorIds = await findDueOperators(
    database,
    sql`SELECT operator_id FROM app.operators_with_rent_due(${returnedSince.toISOString()}::timestamptz) AS operator_id`,
  );
  return forEachOperator(operatorIds, "Charging rent", async (operatorId) => {
    const added = await chargeRentFor(database, operatorId, now);
    return added.charged + added.credited;
  });
}

/**
 * Charges one rental's rent at once, after its handover or return, and
 * issues the invoice or credit note it needs, so the Operator and Renter
 * see it straight away. Never throws: if either fails, the nightly runs add
 * the same lines and documents (rule 20), so it is logged and left.
 */
export async function chargeRentNow(
  deps: BillingDependencies,
  operatorId: string,
  rentalId: string,
): Promise<void> {
  try {
    await chargeRentFor(deps.database, operatorId, deps.now(), [rentalId]);
  } catch (error) {
    console.error(
      "Charging rent straight after a handover or return failed",
      describeErrorForLog(error),
    );
    return;
  }
  await issuePendingDocumentsQuietly(deps, { operatorId }, rentalId);
}
