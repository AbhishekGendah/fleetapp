import {
  findOdometerDrops,
  MAX_EXPORT_ROWS,
  type ListPage,
  type ListQuery,
  type VehicleStatus,
} from "@fleetapp/core";
import type { ExportFormat } from "@fleetapp/core/spreadsheet";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  listConditions,
  listOrderBy,
  loadListPage,
  type DatabaseListRules,
} from "@fleetapp/db/list-query";
import { odometerReadings, vehicleSales, vehicles, type OdometerSource } from "@fleetapp/db/schema";
import { qualified } from "@fleetapp/db/qualified";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, asc, count, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";

import {
  currentInsuranceEndsOn,
  currentRegoExpiresOn,
  isRegoOnDirectDebit,
} from "./expiry-columns";
import { idleSince } from "./car-whereabouts";
import {
  ARCHIVED_FILTER,
  CAR_STATUSES_OF,
  carListFilterCounts,
  carListFilterOf,
  WORKSHOP_FILTER,
  type CarListFilter,
} from "./car-list-filters";
import type { ActingUser } from "../acting-user";
import { recordListExport } from "../list-export-log";
import { countedReading } from "./odometer";

/** The filter value that shows archived cars instead of current ones. */
export const ARCHIVED_FILTER_VALUE = ARCHIVED_FILTER;
/** The filter value for every car in the workshop: in service or off road. */
export const WORKSHOP_FILTER_VALUE = WORKSHOP_FILTER;
export const STATUS_FILTER_KEY = "status";

/** The latest counted reading: what the car's odometer is taken to show now. */
const currentKilometres = sql<number | null>`(
  select ${qualified(odometerReadings.kilometres)} from ${odometerReadings}
  where ${qualified(odometerReadings.vehicleId)} = ${qualified(vehicles.id)} and ${countedReading}
  order by ${qualified(odometerReadings.recordedAt)} desc limit 1
)`;

const summaryColumns = {
  id: vehicles.id,
  rego: vehicles.rego,
  regoState: vehicles.regoState,
  make: vehicles.make,
  model: vehicles.model,
  variant: vehicles.variant,
  year: vehicles.year,
  colour: vehicles.colour,
  status: vehicles.status,
  statusReason: vehicles.statusReason,
  statusExpectedBack: vehicles.statusExpectedBack,
  archivedAt: vehicles.archivedAt,
  currentKilometres,
  isRegoOnDirectDebit,
  regoExpiresOn: currentRegoExpiresOn,
  insuranceEndsOn: currentInsuranceEndsOn,
  idleSince,
};

export interface VehicleSummary {
  id: string;
  rego: string;
  regoState: string;
  make: string;
  model: string;
  variant: string | null;
  year: number;
  colour: string | null;
  status: VehicleStatus;
  /** Why it is in the workshop or off the road, and when it is expected back. */
  statusReason: string | null;
  statusExpectedBack: string | null;
  archivedAt: Date | null;
  currentKilometres: number | null;
  isRegoOnDirectDebit: boolean;
  regoExpiresOn: string | null;
  insuranceEndsOn: string | null;
  /** When it last came back, or was added: for an available car, how long it has sat. */
  idleSince: Date;
}

export const VEHICLE_LIST_RULES: DatabaseListRules = {
  searchIn: [
    vehicles.rego,
    vehicles.make,
    vehicles.model,
    vehicles.variant,
    vehicles.colour,
    vehicles.vin,
  ],
  sortBy: {
    rego: vehicles.rego,
    car: sql`lower(${vehicles.make} || ' ' || ${vehicles.model})`,
    year: vehicles.year,
    kilometres: currentKilometres,
    status: vehicles.status,
    regoExpires: currentRegoExpiresOn,
    insuranceEnds: currentInsuranceEndsOn,
    now: idleSince,
  },
  filterBy: {
    [STATUS_FILTER_KEY]: (value) => {
      const filter = carListFilterOf(value);
      if (!filter || filter === ARCHIVED_FILTER) {
        return undefined;
      }
      return inArray(vehicles.status, [...CAR_STATUSES_OF[filter]]);
    },
  },
  tieBreaker: vehicles.id,
};

/** Current cars unless the archived ones were asked for. */
function archivedCondition(query: ListQuery): SQL {
  return carListFilterOf(query.filters[STATUS_FILTER_KEY]) === ARCHIVED_FILTER
    ? isNotNull(vehicles.archivedAt)
    : isNull(vehicles.archivedAt);
}

function matchingVehicles(operatorId: string, query: ListQuery): SQL | undefined {
  return and(
    eq(vehicles.operatorId, operatorId),
    archivedCondition(query),
    listConditions(VEHICLE_LIST_RULES, query),
  );
}

function selectVehicleSummaries(tx: AnyTransaction, where: SQL | undefined, query: ListQuery) {
  return tx
    .select(summaryColumns)
    .from(vehicles)
    .where(where)
    .orderBy(...listOrderBy(VEHICLE_LIST_RULES, query));
}

/** One page of the Operator's cars, searched, filtered and sorted by the database. */
export async function listVehiclePage(
  database: AnyDatabase,
  operatorId: string,
  query: ListQuery,
): Promise<ListPage<VehicleSummary>> {
  const where = matchingVehicles(operatorId, query);
  return withTenant(database, operatorId, (tx) =>
    loadListPage(query, {
      count: async () => {
        const [row] = await tx.select({ total: count() }).from(vehicles).where(where);
        return row?.total ?? 0;
      },
      rows: ({ offset, limit }) =>
        selectVehicleSummaries(tx, where, query).limit(limit).offset(offset),
    }),
  );
}

/** One of the Operator's cars as the list shows it (its rego and insurance dates, idle since), or null. */
export async function loadVehicleSummary(
  database: AnyDatabase,
  operatorId: string,
  vehicleId: string,
): Promise<VehicleSummary | null> {
  const [summary] = await withTenant(database, operatorId, (tx) =>
    tx
      .select(summaryColumns)
      .from(vehicles)
      .where(and(eq(vehicles.operatorId, operatorId), eq(vehicles.id, vehicleId))),
  );
  return summary ?? null;
}

/** Every car the query matches, up to the export limit. */
export async function listVehiclesForExport(
  database: AnyDatabase,
  operatorId: string,
  query: ListQuery,
): Promise<VehicleSummary[]> {
  return withTenant(database, operatorId, (tx) =>
    selectVehicleSummaries(tx, matchingVehicles(operatorId, query), query).limit(MAX_EXPORT_ROWS),
  );
}

/**
 * The cars list as a download, logged: it names the Renters who have the
 * cars, so it is personal information leaving the app (review A8-8).
 */
export async function exportVehicles(
  database: AnyDatabase,
  actor: ActingUser,
  query: ListQuery,
  format: ExportFormat,
): Promise<VehicleSummary[]> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const rows = await selectVehicleSummaries(
      tx,
      matchingVehicles(actor.operatorId, query),
      query,
    ).limit(MAX_EXPORT_ROWS);
    await recordListExport(tx, actor, { list: "cars", format, rows: rows.length });
    return rows;
  });
}

/** How many of the Operator's cars each of the list's filters holds, and all current ones. */
export async function countCarsByFilter(
  database: AnyDatabase,
  operatorId: string,
): Promise<Record<CarListFilter | "all", number>> {
  const isArchived = sql<boolean>`${vehicles.archivedAt} is not null`;
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({ status: vehicles.status, isArchived, total: count() })
      .from(vehicles)
      .where(eq(vehicles.operatorId, operatorId))
      .groupBy(vehicles.status, isArchived),
  );
  const current = rows.filter((row) => !row.isArchived);
  const archived = rows.filter((row) => row.isArchived).reduce((sum, row) => sum + row.total, 0);
  return carListFilterCounts(
    Object.fromEntries(current.map((row) => [row.status, row.total])),
    archived,
  );
}

/** Whether the Operator has any cars at all, archived ones included. */
export async function hasAnyVehicle(database: AnyDatabase, operatorId: string): Promise<boolean> {
  const [row] = await withTenant(database, operatorId, (tx) =>
    tx
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.operatorId, operatorId))
      .limit(1),
  );
  return row !== undefined;
}

export interface OdometerReadingView {
  id: string;
  kilometres: number;
  recordedAt: Date;
  source: OdometerSource;
  isVerified: boolean;
  withdrawnAt: Date | null;
  /** Lower than the reading before it. */
  isDrop: boolean;
}

export type VehicleDetail = typeof vehicles.$inferSelect & {
  currentKilometres: number | null;
  /** Sold, but the transfer is not lodged yet: fines can still reach the Operator. */
  isTransferPending: boolean;
  /** Newest first. */
  readings: OdometerReadingView[];
};

/** One of the Operator's cars with its odometer history, or null if it is not theirs. */
export async function loadVehicle(
  database: AnyDatabase,
  operatorId: string,
  vehicleId: string,
): Promise<VehicleDetail | null> {
  return withTenant(database, operatorId, async (tx) => {
    const [vehicle] = await tx
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.id, vehicleId), eq(vehicles.operatorId, operatorId)));
    if (!vehicle) {
      return null;
    }
    const readings = await tx
      .select({
        id: odometerReadings.id,
        kilometres: odometerReadings.kilometres,
        recordedAt: odometerReadings.recordedAt,
        source: odometerReadings.source,
        isVerified: odometerReadings.isVerified,
        withdrawnAt: odometerReadings.withdrawnAt,
      })
      .from(odometerReadings)
      .where(eq(odometerReadings.vehicleId, vehicleId))
      .orderBy(asc(odometerReadings.recordedAt));
    const [pendingTransfer] = await tx
      .select({ id: vehicleSales.id })
      .from(vehicleSales)
      .where(
        and(
          eq(vehicleSales.operatorId, operatorId),
          eq(vehicleSales.vehicleId, vehicleId),
          isNull(vehicleSales.cancelledAt),
          isNull(vehicleSales.transferLodgedOn),
        ),
      );

    const counted = readings.filter((reading) => reading.isVerified && !reading.withdrawnAt);
    const drops = findOdometerDrops(counted);
    return {
      ...vehicle,
      currentKilometres: counted.at(-1)?.kilometres ?? null,
      isTransferPending: pendingTransfer !== undefined,
      readings: readings
        .map((reading) => ({ ...reading, isDrop: drops.has(reading.id) }))
        .reverse(),
    };
  });
}
