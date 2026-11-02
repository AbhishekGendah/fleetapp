import { addDays, type VehicleStatus } from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import { qualified } from "@fleetapp/db/qualified";
import { carHolds, rentals, renterSubmissions, renters, vehicles } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, asc, count, eq, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import type { SelectedFields } from "drizzle-orm/pg-core";

import { idleSince } from "../vehicles/car-whereabouts";
import {
  currentInsuranceEndsOn,
  currentRegoExpiresOn,
  isRegoOnDirectDebit,
} from "../vehicles/expiry-columns";

/** How many of a long list the dashboard shows before "See all". */
export const DASHBOARD_LIST_LENGTH = 5;

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
const STATUSES_IN_WORKSHOP: readonly VehicleStatus[] = ["in_service", "off_road"];

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
  request: { where: SQL | undefined; columns: Extra; orderBy: SQL },
) {
  return withTenant(database, operatorId, async (tx) => {
    const [counted] = await tx.select({ total: count() }).from(vehicles).where(request.where);
    const items = await tx
      .select({ ...CAR_COLUMNS, ...request.columns })
      .from(vehicles)
      .where(request.where)
      .orderBy(request.orderBy, asc(vehicles.rego))
      .limit(DASHBOARD_LIST_LENGTH);
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

/** No live hold on the car that has not yet ended: nothing booked from now on. */
function hasNothingBookedAhead(now: Date): SQL {
  return sql`not exists (
    select 1 from ${carHolds}
    where ${qualified(carHolds.vehicleId)} = ${qualified(vehicles.id)}
      and ${qualified(carHolds.releasedAt)} is null
      and (upper_inf(${qualified(carHolds.heldDuring)}) or upper(${qualified(carHolds.heldDuring)}) > ${now.toISOString()})
  )`;
}

export interface CarOnList {
  id: string;
  rego: string;
  make: string;
  model: string;
}

export interface IdleCar extends CarOnList {
  idleSince: Date;
}

/** Available cars with nothing booked ahead, the longest idle first. */
export async function loadIdleCars(
  database: AnyDatabase,
  operatorId: string,
  now: Date,
): Promise<FewOfMany<IdleCar>> {
  const where = and(
    inFleet(operatorId),
    eq(vehicles.status, "available"),
    hasNothingBookedAhead(now),
  );
  return fewCars(database, operatorId, {
    where,
    columns: { idleSince },
    orderBy: asc(idleSince),
  });
}

export interface CarPaperworkDue extends CarOnList {
  isRegoOnDirectDebit: boolean;
  regoExpiresOn: string | null;
  insuranceEndsOn: string | null;
}

/** Rego or insurance expired or due within the warning days, for cars still in the fleet. */
export async function loadPaperworkDue(
  database: AnyDatabase,
  operatorId: string,
  expiry: { today: string; warningDays: number },
): Promise<FewOfMany<CarPaperworkDue>> {
  const dueBy = addDays(expiry.today, expiry.warningDays);
  const firstDue = sql`least(${currentRegoExpiresOn}, ${currentInsuranceEndsOn})`;
  const where = and(inFleet(operatorId), sql`${firstDue} <= ${dueBy}::date`);
  return fewCars(database, operatorId, {
    where,
    columns: {
      isRegoOnDirectDebit,
      regoExpiresOn: currentRegoExpiresOn,
      insuranceEndsOn: currentInsuranceEndsOn,
    },
    orderBy: asc(firstDue),
  });
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
): Promise<FewOfMany<CarInWorkshop>> {
  const where = and(
    inFleet(operatorId),
    inArray(vehicles.status, [...STATUSES_IN_WORKSHOP]),
    lt(vehicles.statusExpectedBack, today),
  );
  return fewCars(database, operatorId, {
    where,
    columns: { status: vehicles.status, statusExpectedBack: vehicles.statusExpectedBack },
    orderBy: asc(vehicles.statusExpectedBack),
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
      .limit(DASHBOARD_LIST_LENGTH);
    return { total: counted?.total ?? 0, items };
  });
}

/** Renters whose details, sent through their link, wait for the Operator to look at them. */
export async function loadReviewsWaiting(
  database: AnyDatabase,
  operatorId: string,
): Promise<FewOfMany<RenterOnList>> {
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
      .select({ id: renters.id, fullName: renters.fullName })
      .from(renterSubmissions)
      .innerJoin(renters, renterOfSubmission)
      .where(where)
      .orderBy(asc(renterSubmissions.createdAt))
      .limit(DASHBOARD_LIST_LENGTH);
    return { total: counted?.total ?? 0, items };
  });
}
