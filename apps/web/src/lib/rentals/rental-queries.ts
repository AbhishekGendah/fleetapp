import {
  blockStartsAt,
  formatCalendarDate,
  formatDateTimeInTimeZone,
  MILLISECONDS_PER_DAY,
  todayInTimeZone,
  type ListPage,
  type ListQuery,
  type RentalStatus,
  type RentModel,
  type RentalType,
} from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  listConditions,
  listOrderBy,
  loadListPage,
  type DatabaseListRules,
} from "@fleetapp/db/list-query";
import { carHolds, rentalRates, rentals, renters, vehicles } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { isRentalOfCar } from "./rental-of-car";
import { rentalRateText } from "./rental-labels";
import type { RentalClock } from "./rental-records";
import { rentalListStatusOf, RENTAL_STATUSES_OF } from "./rental-list-status";
import { and, asc, count, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";

export const STATUS_FILTER_KEY = "status";

/** Each rental's Renter and car, matched on the Operator too (the two-column links). */
export const RENTER_OF_RENTAL = and(
  eq(renters.id, rentals.renterId),
  eq(renters.operatorId, rentals.operatorId),
);
export const CAR_OF_RENTAL = and(
  eq(vehicles.id, rentals.vehicleId),
  eq(vehicles.operatorId, rentals.operatorId),
);
/** A booking starting within this many days is badged "Starting soon". */
export const STARTING_SOON_DAYS = 3;

/**
 * True while this rental has its car out past the planned end. The car's
 * next booking is then at risk: the database cannot know the car is late.
 */
function isOverdueAt(now: Date): SQL<boolean> {
  return sql<boolean>`(${rentals.status} = 'active' and ${rentals.plannedEnd} < ${now.toISOString()})`;
}

function isStartingSoonAt(now: Date): SQL<boolean> {
  return sql<boolean>`(${rentals.status} = 'booked'
    and ${rentals.plannedStart} < ${new Date(now.getTime() + STARTING_SOON_DAYS * MILLISECONDS_PER_DAY).toISOString()})`;
}

/** A booking whose car is still out, overdue, on another rental. Table names written out for the sub-query. */
function isAtRiskAt(now: Date): SQL<boolean> {
  return sql<boolean>`(${rentals.status} = 'booked' and exists (
    select 1 from "rentals" "overdue"
    where "overdue"."operator_id" = "rentals"."operator_id"
      and "overdue"."vehicle_id" = "rentals"."vehicle_id"
      and "overdue"."status" = 'active'
      and "overdue"."planned_end" < ${now.toISOString()}
  ))`;
}

/**
 * A rate column in force now: the latest rate that has started (by block for
 * block rentals, by date for weekday ones), else the first.
 */
function rateInForce(
  column: "weekly_rate_cents" | "daily_rate_cents",
  now: Date,
  today: string,
): SQL<number | null> {
  return sql<number | null>`(
    select "rate".${sql.identifier(column)} from "rental_rates" "rate"
    where "rate"."rental_id" = "rentals"."id" and "rate"."operator_id" = "rentals"."operator_id"
    order by (case when "rentals"."rent_model" = 'blocks'
        then "rate"."applies_from_block" <= floor(extract(epoch from (${now.toISOString()}::timestamptz
          - coalesce("rentals"."handed_over_at", ${now.toISOString()}::timestamptz))) / 86400)
        else "rate"."applies_from" <= ${today}::date end) desc,
      "rate"."applies_from_block" desc nulls last, "rate"."applies_from" desc nulls last
    limit 1
  )`.mapWith((value) => (value === null ? null : Number(value)));
}

function summaryColumnsAt({ now, timeZone }: RentalClock) {
  return {
    id: rentals.id,
    status: rentals.status,
    type: rentals.type,
    plannedStart: rentals.plannedStart,
    plannedEnd: rentals.plannedEnd,
    renterId: rentals.renterId,
    renterFullName: renters.fullName,
    renterPreferredName: renters.preferredName,
    vehicleId: rentals.vehicleId,
    rego: vehicles.rego,
    make: vehicles.make,
    model: vehicles.model,
    weeklyRateCents: rateInForce("weekly_rate_cents", now, todayInTimeZone(now, timeZone)),
    dailyRateCents: rateInForce("daily_rate_cents", now, todayInTimeZone(now, timeZone)),
    isLongTerm: rentals.isLongTerm,
    handedOverAt: rentals.handedOverAt,
    returnedAt: rentals.returnedAt,
    isOverdue: isOverdueAt(now),
    isStartingSoon: isStartingSoonAt(now),
    isAtRisk: isAtRiskAt(now),
  };
}

export interface RentalSummary {
  id: string;
  status: RentalStatus;
  type: RentalType;
  plannedStart: Date;
  plannedEnd: Date | null;
  renterId: string;
  renterFullName: string;
  renterPreferredName: string | null;
  vehicleId: string;
  rego: string;
  make: string;
  model: string;
  /** The weekly price in force now; none on a short hire. */
  weeklyRateCents: number | null;
  /** The daily rate in force now; none on a rental from before rent in blocks. */
  dailyRateCents: number | null;
  /** Long-term or a short hire; none on a rental from before rent in blocks. */
  isLongTerm: boolean | null;
  handedOverAt: Date | null;
  returnedAt: Date | null;
  isOverdue: boolean;
  isStartingSoon: boolean;
  isAtRisk: boolean;
}

/** Not a column: the Rentals list's own order, most relevant first. */
export const RELEVANCE_ORDER = "relevance";

/**
 * Out first, the soonest back at the top (ongoing ones after); then bookings
 * and drafts, the soonest to start first; then those to close, the longest
 * waiting first; then the finished, the latest first.
 */
const MOST_RELEVANT_FIRST = sql`(
  case ${rentals.status} when 'active' then 0 when 'booked' then 1 when 'draft' then 2
    when 'returned' then 3 else 4 end,
  case when ${rentals.status} = 'active' then extract(epoch from ${rentals.plannedEnd})
    when ${rentals.status} in ('booked', 'draft') then extract(epoch from ${rentals.plannedStart})
    when ${rentals.status} = 'returned' then extract(epoch from coalesce(${rentals.returnedAt}, ${rentals.plannedEnd}))
    else -extract(epoch from ${rentals.plannedStart}) end
)`;

export const RENTAL_LIST_RULES: DatabaseListRules = {
  searchIn: [renters.fullName, renters.preferredName, vehicles.rego],
  sortBy: {
    [RELEVANCE_ORDER]: MOST_RELEVANT_FIRST,
    start: rentals.plannedStart,
    end: rentals.plannedEnd,
    renter: sql`lower(${renters.fullName})`,
    rego: vehicles.rego,
    status: rentals.status,
  },
  filterBy: {
    [STATUS_FILTER_KEY]: (value) => {
      const group = rentalListStatusOf(value);
      return group ? inArray(rentals.status, [...RENTAL_STATUSES_OF[group]]) : undefined;
    },
  },
  tieBreaker: rentals.id,
};

/** Only one car's or one Renter's rentals, for the tabs on their pages. */
export type RentalScope = { vehicleId: string } | { renterId: string } | Record<string, never>;

function scopeCondition(scope: RentalScope): SQL | undefined {
  if ("vehicleId" in scope) {
    return isRentalOfCar(scope.vehicleId);
  }
  return "renterId" in scope ? eq(rentals.renterId, scope.renterId) : undefined;
}

function selectRentalSummaries(tx: AnyTransaction, clock: RentalClock) {
  return tx
    .select(summaryColumnsAt(clock))
    .from(rentals)
    .innerJoin(renters, RENTER_OF_RENTAL)
    .innerJoin(vehicles, CAR_OF_RENTAL);
}

/** The Operator's rentals that match, soonest start first, up to `limit`: for the dashboard. */
export async function listRentalSummaries(
  database: AnyDatabase,
  operatorId: string,
  options: { where: SQL | undefined; clock: RentalClock; limit: number },
): Promise<RentalSummary[]> {
  return withTenant(database, operatorId, (tx) =>
    selectRentalSummaries(tx, options.clock)
      .where(and(eq(rentals.operatorId, operatorId), options.where))
      .orderBy(asc(rentals.plannedStart), asc(rentals.id))
      .limit(options.limit),
  );
}

/** One page of the Operator's rentals, searched, filtered and sorted by the database. */
export async function listRentalPage(
  database: AnyDatabase,
  operatorId: string,
  query: ListQuery,
  options: { clock: RentalClock; scope?: RentalScope },
): Promise<ListPage<RentalSummary>> {
  const where = and(
    eq(rentals.operatorId, operatorId),
    scopeCondition(options.scope ?? {}),
    listConditions(RENTAL_LIST_RULES, query),
  );
  return withTenant(database, operatorId, (tx) =>
    loadListPage(query, {
      count: async () => {
        const [row] = await tx
          .select({ total: count() })
          .from(rentals)
          .innerJoin(renters, RENTER_OF_RENTAL)
          .innerJoin(vehicles, CAR_OF_RENTAL)
          .where(where);
        return row?.total ?? 0;
      },
      rows: ({ offset, limit }) =>
        selectRentalSummaries(tx, options.clock)
          .where(where)
          .orderBy(...listOrderBy(RENTAL_LIST_RULES, query))
          .limit(limit)
          .offset(offset),
    }),
  );
}

export interface RentalDetail extends RentalSummary {
  rentModel: RentModel;
  graceMinutes: number | null;
  longTermMinimumDays: number | null;
  /** Set once the business waived the daily-rate re-pricing at the return. */
  dailyRateWaivedReason: string | null;
  chargeWeekday: number;
  bondCents: number;
  notes: string | null;
  handedOverAt: Date | null;
  returnedAt: Date | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  settingsVersion: number;
  /** The Operator's settings when it was made (rule 14). */
  settingsSnapshot: Record<string, unknown>;
  createdAt: Date;
  /** The rate history, newest first, worded for the rental page. */
  rates: { key: string; startsText: string; rateText: string }[];
}

/** When a rate starts, in words: a date, the handover, or a rent week's start on the business's clock. */
function rateStartText(
  rate: { appliesFrom: string | null; appliesFromBlock: number | null },
  handedOverAt: Date | null,
  timeZone: string,
): string {
  if (rate.appliesFrom !== null) {
    return `From ${formatCalendarDate(rate.appliesFrom)}`;
  }
  if (!rate.appliesFromBlock || !handedOverAt) {
    return "From the handover";
  }
  return `From ${formatDateTimeInTimeZone(blockStartsAt(handedOverAt, rate.appliesFromBlock), timeZone)}`;
}

/** One of the Operator's rentals with its rate history, or null if it is not theirs. */
export async function loadRental(
  database: AnyDatabase,
  operatorId: string,
  rentalId: string,
  clock: RentalClock,
): Promise<RentalDetail | null> {
  return withTenant(database, operatorId, async (tx) => {
    const [summary] = await selectRentalSummaries(tx, clock).where(
      and(eq(rentals.id, rentalId), eq(rentals.operatorId, operatorId)),
    );
    if (!summary) {
      return null;
    }
    const [details] = await tx
      .select({
        chargeWeekday: rentals.chargeWeekday,
        rentModel: rentals.rentModel,
        graceMinutes: rentals.graceMinutes,
        longTermMinimumDays: rentals.longTermMinimumDays,
        dailyRateWaivedReason: rentals.dailyRateWaivedReason,
        bondCents: rentals.bondCents,
        notes: rentals.notes,
        handedOverAt: rentals.handedOverAt,
        returnedAt: rentals.returnedAt,
        cancelledAt: rentals.cancelledAt,
        cancellationReason: rentals.cancellationReason,
        settingsVersion: rentals.settingsVersion,
        settingsSnapshot: rentals.settingsSnapshot,
        createdAt: rentals.createdAt,
      })
      .from(rentals)
      .where(eq(rentals.id, rentalId));
    const rateRows = await tx
      .select({
        id: rentalRates.id,
        weeklyRateCents: rentalRates.weeklyRateCents,
        dailyRateCents: rentalRates.dailyRateCents,
        appliesFrom: rentalRates.appliesFrom,
        appliesFromBlock: rentalRates.appliesFromBlock,
      })
      .from(rentalRates)
      .where(and(eq(rentalRates.operatorId, operatorId), eq(rentalRates.rentalId, rentalId)))
      .orderBy(desc(rentalRates.appliesFromBlock), desc(rentalRates.appliesFrom));
    if (!details) {
      return null;
    }
    const rates = rateRows.map((row) => ({
      key: row.id,
      startsText: rateStartText(row, details.handedOverAt, clock.timeZone),
      rateText: rentalRateText({ ...row, isLongTerm: summary.isLongTerm }),
    }));
    return { ...summary, ...details, rates };
  });
}

/** A booking on the calendar: the time its car is held. */
export interface CalendarBooking {
  rentalId: string;
  status: RentalStatus;
  renterId: string;
  vehicleId: string;
  rego: string;
  make: string;
  model: string;
  renterFullName: string;
  renterPreferredName: string | null;
  heldFrom: Date;
  /** None while ongoing. */
  heldUntil: Date | null;
}

/** Every live hold that overlaps the window, optionally on one car, for the calendar. */
export async function listCalendarBookings(
  database: AnyDatabase,
  operatorId: string,
  window: { from: Date; to: Date; vehicleId?: string },
): Promise<CalendarBooking[]> {
  return withTenant(database, operatorId, (tx) =>
    tx
      .select({
        rentalId: rentals.id,
        status: rentals.status,
        renterId: rentals.renterId,
        vehicleId: carHolds.vehicleId,
        rego: vehicles.rego,
        make: vehicles.make,
        model: vehicles.model,
        renterFullName: renters.fullName,
        renterPreferredName: renters.preferredName,
        heldFrom: sql<Date>`lower(${carHolds.heldDuring})`.mapWith(carHolds.createdAt),
        heldUntil: sql<Date | null>`upper(${carHolds.heldDuring})`.mapWith(carHolds.createdAt),
      })
      .from(carHolds)
      .innerJoin(
        rentals,
        and(eq(rentals.id, carHolds.rentalId), eq(rentals.operatorId, carHolds.operatorId)),
      )
      .innerJoin(renters, RENTER_OF_RENTAL)
      .innerJoin(
        vehicles,
        and(eq(vehicles.id, carHolds.vehicleId), eq(vehicles.operatorId, carHolds.operatorId)),
      )
      .where(
        and(
          eq(carHolds.operatorId, operatorId),
          isNull(carHolds.releasedAt),
          window.vehicleId ? eq(carHolds.vehicleId, window.vehicleId) : undefined,
          sql`${carHolds.heldDuring} && tstzrange(${window.from.toISOString()}, ${window.to.toISOString()}, '[)')`,
        ),
      )
      .orderBy(asc(sql`lower(${carHolds.heldDuring})`)),
  );
}

/** How many of the Operator's rentals are at each status, for the list's filters. */
export async function countRentalsByStatus(
  database: AnyDatabase,
  operatorId: string,
): Promise<Partial<Record<RentalStatus, number>>> {
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({ status: rentals.status, total: count() })
      .from(rentals)
      .where(eq(rentals.operatorId, operatorId))
      .groupBy(rentals.status),
  );
  return Object.fromEntries(rows.map((row) => [row.status, row.total]));
}
