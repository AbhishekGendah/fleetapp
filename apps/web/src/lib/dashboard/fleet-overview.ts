import { addDays, VEHICLE_STATUSES_IN_WORKSHOP, type VehicleStatus } from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import { qualified } from "@fleetapp/db/qualified";
import { rentals, renterSubmissions, renters, vehicles } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, asc, count, eq, inArray, isNull, lt, not, or, sql, type SQL } from "drizzle-orm";
import type { SelectedFields } from "drizzle-orm/pg-core";

import {
  currentInsuranceEndsOn,
  currentRegoExpiresOn,
  isInsuredOn,
  isRegisteredOn,
  isRegoOnDirectDebit,
} from "../vehicles/expiry-columns";

/** How many of a long list the dashboard shows before "See all". */
export const DASHBOARD_LIST_LENGTH = 5;
/**
 * The most of one kind the full Needs attention page loads. Far more than
 * any fleet has waiting at once; the page shows them 25 at a time.
 */
export const MOST_OF_A_KIND = 1_000;

/** A few of a list, and how many there are in all. */
export interface FewOfMany<Item> {
  total: number;
  items: Item[];
}

/** Cars still in the fleet: not archived, sold or written off. */
const STATUSES_IN_FLEET: readonly VehicleStatus[] = [
  "available",
  "rented",
  "in_service",
  "off_road",
];

function inFleet(operatorId: string): SQL | undefined {
  return and(
    eq(vehicles.operatorId, operatorId),
    isNull(vehicles.archivedAt),
    inArray(vehicles.status, [...STATUSES_IN_FLEET]),
  );
}

const CAR_COLUMNS = {
  id: vehicles.id,
  rego: vehicles.rego,
  make: vehicles.make,
  model: vehicles.model,
};

/** The first few cars that match, with the columns a list needs, and how many match in all. */
function fewCars<Extra extends SelectedFields>(
  database: AnyDatabase,
  operatorId: string,
  request: { where: SQL | undefined; columns: Extra; orderBy: SQL; limit: number },
) {
  return withTenant(database, operatorId, async (tx) => {
    const [counted] = await tx.select({ total: count() }).from(vehicles).where(request.where);
    const items = await tx
      .select({ ...CAR_COLUMNS, ...request.columns })
      .from(vehicles)
      .where(request.where)
      .orderBy(request.orderBy, asc(vehicles.rego))
      .limit(request.limit);
    return { total: counted?.total ?? 0, items };
  });
}

/** How many current cars have each status. */
export async function loadFleetCounts(
  database: AnyDatabase,
  operatorId: string,
): Promise<Partial<Record<VehicleStatus, number>>> {
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({ status: vehicles.status, total: count() })
      .from(vehicles)
      .where(and(eq(vehicles.operatorId, operatorId), isNull(vehicles.archivedAt)))
      .groupBy(vehicles.status),
  );
  return Object.fromEntries(rows.map((row) => [row.status, row.total]));
}

export interface CarOnList {
  id: string;
  rego: string;
  make: string;
  model: string;
}

export interface CarPaperworkDue extends CarOnList {
  isRegoOnDirectDebit: boolean;
  regoExpiresOn: string | null;
  insuranceEndsOn: string | null;
  /** Cover today: none on file at all counts as missing, not as fine (review A8-2). */
  isInsuredToday: boolean;
  isRegisteredToday: boolean;
}

/**
 * Rego or insurance expired, due within the warning days, or missing today
 * (no policy, one not started yet, a direct debit stopped), for cars still in
 * the fleet.
 */
export async function loadPaperworkDue(
  database: AnyDatabase,
  operatorId: string,
  expiry: { today: string; warningDays: number },
  limit = DASHBOARD_LIST_LENGTH,
): Promise<FewOfMany<CarPaperworkDue>> {
  const dueBy = addDays(expiry.today, expiry.warningDays);
  const firstDue = sql`least(${currentRegoExpiresOn}, ${currentInsuranceEndsOn})`;
  const isInsuredToday = isInsuredOn(expiry.today);
  const isRegisteredToday = isRegisteredOn(expiry.today);
  const where = and(
    inFleet(operatorId),
    or(sql`${firstDue} <= ${dueBy}::date`, not(isInsuredToday), not(isRegisteredToday)),
  );
  return fewCars(database, operatorId, {
    where,
    columns: {
      isRegoOnDirectDebit,
      regoExpiresOn: currentRegoExpiresOn,
      insuranceEndsOn: currentInsuranceEndsOn,
      isInsuredToday,
      isRegisteredToday,
    },
    // Not covered today first, then the longest waiting (as Needs attention sorts them).
    orderBy: sql`(${isInsuredToday} and ${isRegisteredToday}), ${paperworkWaitingSince(expiry.today)} asc`,
    limit,
  });
}

/** A paper that lapsed counts from the day it ended; one missing outright, from forever. */
function lapsedSince(endsOn: SQL<string | null>, today: string): SQL {
  return sql`case when ${endsOn} < ${today}::date then ${endsOn} else '-infinity'::date end`;
}

/**
 * Since when a car's paperwork has waited: covered today, from the first
 * one due; not covered, from the first lapse. The same rule as
 * paperworkWaitingSince in attention-items.ts, so the dashboard's few are
 * the most urgent.
 */
function paperworkWaitingSince(today: string): SQL {
  const isInsuredToday = isInsuredOn(today);
  const isRegisteredToday = isRegisteredOn(today);
  return sql`case when ${isInsuredToday} and ${isRegisteredToday}
    then least(${currentRegoExpiresOn}, ${currentInsuranceEndsOn})
    else least(
      case when not ${isRegisteredToday} then ${lapsedSince(currentRegoExpiresOn, today)} end,
      case when not ${isInsuredToday} then ${lapsedSince(currentInsuranceEndsOn, today)} end
    ) end`;
}

export interface CarInWorkshop extends CarOnList {
  status: VehicleStatus;
  statusExpectedBack: string | null;
}

/** In service or off road past the day it was expected back. */
export async function loadWorkshopLate(
  database: AnyDatabase,
  operatorId: string,
  today: string,
  limit = DASHBOARD_LIST_LENGTH,
): Promise<FewOfMany<CarInWorkshop>> {
  const where = and(
    inFleet(operatorId),
    inArray(vehicles.status, [...VEHICLE_STATUSES_IN_WORKSHOP]),
    lt(vehicles.statusExpectedBack, today),
  );
  return fewCars(database, operatorId, {
    where,
    columns: { status: vehicles.status, statusExpectedBack: vehicles.statusExpectedBack },
    orderBy: asc(vehicles.statusExpectedBack),
    limit,
  });
}

export interface RenterOnList {
  id: string;
  fullName: string;
}

export interface RenterLicenceDue extends RenterOnList {
  licenceExpiresOn: string;
}

/** A booked or active rental of this Renter: only their licence matters today. */
const hasRentalUnderWay = sql`exists (
  select 1 from ${rentals}
  where ${qualified(rentals.renterId)} = ${qualified(renters.id)}
    and ${qualified(rentals.status)} in ('booked', 'active')
)`;

/** Licences expired or due within the licence warning days, of Renters renting now or soon. */
export async function loadLicencesDue(
  database: AnyDatabase,
  operatorId: string,
  expiry: { today: string; warningDays: number },
  limit = DASHBOARD_LIST_LENGTH,
): Promise<FewOfMany<RenterLicenceDue>> {
  const where = and(
    eq(renters.operatorId, operatorId),
    isNull(renters.archivedAt),
    sql`${renters.licenceExpiresOn} <= ${addDays(expiry.today, expiry.warningDays)}::date`,
    hasRentalUnderWay,
  );
  return withTenant(database, operatorId, async (tx) => {
    const [counted] = await tx.select({ total: count() }).from(renters).where(where);
    const items = await tx
      .select({
        id: renters.id,
        fullName: renters.fullName,
        licenceExpiresOn: sql<string>`${renters.licenceExpiresOn}`,
      })
      .from(renters)
      .where(where)
      .orderBy(asc(renters.licenceExpiresOn), asc(renters.fullName))
      .limit(limit);
    return { total: counted?.total ?? 0, items };
  });
}

export interface RenterDetailsWaiting extends RenterOnList {
  /** When the Renter sent them: the longest waiting comes first. */
  sentAt: Date;
}

/** Renters whose details, sent through their link, wait for the Operator to look at them. */
export async function loadReviewsWaiting(
  database: AnyDatabase,
  operatorId: string,
  limit = DASHBOARD_LIST_LENGTH,
): Promise<FewOfMany<RenterDetailsWaiting>> {
  const where = and(
    eq(renterSubmissions.operatorId, operatorId),
    eq(renterSubmissions.status, "waiting"),
    isNull(renters.archivedAt),
  );
  const renterOfSubmission = and(
    eq(renters.id, renterSubmissions.renterId),
    eq(renters.operatorId, renterSubmissions.operatorId),
  );
  return withTenant(database, operatorId, async (tx) => {
    const [counted] = await tx
      .select({ total: count() })
      .from(renterSubmissions)
      .innerJoin(renters, renterOfSubmission)
      .where(where);
    const items = await tx
      .select({ id: renters.id, fullName: renters.fullName, sentAt: renterSubmissions.createdAt })
      .from(renterSubmissions)
      .innerJoin(renters, renterOfSubmission)
      .where(where)
      .orderBy(asc(renterSubmissions.createdAt), asc(renterSubmissions.id))
      .limit(limit);
    return { total: counted?.total ?? 0, items };
  });
}
