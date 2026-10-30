import { MAX_EXPORT_ROWS, type ListPage, type ListQuery, type RenterStatus } from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  listConditions,
  listOrderBy,
  loadListPage,
  type DatabaseListRules,
} from "@fleetapp/db/list-query";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, renters } from "@fleetapp/db/schema";
import type { ExportFormat } from "@fleetapp/core/spreadsheet";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, asc, count, eq, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";

/** The filter value that shows archived Renters instead of current ones. */
export const ARCHIVED_FILTER_VALUE = "archived";
export const STATUS_FILTER_KEY = "status";

const summaryColumns = {
  id: renters.id,
  fullName: renters.fullName,
  preferredName: renters.preferredName,
  phone: renters.phone,
  email: renters.email,
  status: renters.status,
  archivedAt: renters.archivedAt,
};

export interface RenterSummary {
  id: string;
  fullName: string;
  preferredName: string | null;
  phone: string | null;
  email: string | null;
  status: RenterStatus;
  archivedAt: Date | null;
}

export const RENTER_LIST_RULES: DatabaseListRules = {
  searchIn: [renters.fullName, renters.preferredName, renters.phone, renters.email],
  sortBy: {
    name: sql`lower(${renters.fullName})`,
    status: renters.status,
  },
  filterBy: {
    [STATUS_FILTER_KEY]: (value) =>
      value === ARCHIVED_FILTER_VALUE ? undefined : sql`${renters.status} = ${value}`,
  },
  tieBreaker: renters.id,
};

/** Current Renters unless the archived ones were asked for. */
function archivedCondition(query: ListQuery): SQL {
  return query.filters[STATUS_FILTER_KEY] === ARCHIVED_FILTER_VALUE
    ? isNotNull(renters.archivedAt)
    : isNull(renters.archivedAt);
}

function matchingRenters(operatorId: string, query: ListQuery): SQL | undefined {
  return and(
    eq(renters.operatorId, operatorId),
    archivedCondition(query),
    listConditions(RENTER_LIST_RULES, query),
  );
}

function selectRenterSummaries(tx: AnyTransaction, where: SQL | undefined, query: ListQuery) {
  return tx
    .select(summaryColumns)
    .from(renters)
    .where(where)
    .orderBy(...listOrderBy(RENTER_LIST_RULES, query));
}

/** One page of the Operator's Renters, searched, filtered and sorted by the database. */
export async function listRenterPage(
  database: AnyDatabase,
  operatorId: string,
  query: ListQuery,
): Promise<ListPage<RenterSummary>> {
  const where = matchingRenters(operatorId, query);
  return withTenant(database, operatorId, (tx) =>
    loadListPage(query, {
      count: async () => {
        const [row] = await tx.select({ total: count() }).from(renters).where(where);
        return row?.total ?? 0;
      },
      rows: ({ offset, limit }) =>
        selectRenterSummaries(tx, where, query).limit(limit).offset(offset),
    }),
  );
}

/**
 * Every Renter the query matches, up to the export limit. The download is
 * personal information leaving the app, so who took it and when is logged.
 */
export async function exportRenters(
  database: AnyDatabase,
  actor: ActingUser,
  query: ListQuery,
  format: ExportFormat,
): Promise<RenterSummary[]> {
  return withTenant(database, actor.operatorId, async (tx) => {
    const rows = await selectRenterSummaries(
      tx,
      matchingRenters(actor.operatorId, query),
      query,
    ).limit(MAX_EXPORT_ROWS);
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.operator,
      entityId: actor.operatorId,
      action: ACTIVITY_ACTIONS.exported,
      valuesAfter: { list: "renters", format, rows: rows.length },
    });
    return rows;
  });
}

/** Whether the Operator has any Renters at all, archived ones included. */
export async function hasAnyRenter(database: AnyDatabase, operatorId: string): Promise<boolean> {
  const [row] = await withTenant(database, operatorId, (tx) =>
    tx.select({ id: renters.id }).from(renters).where(eq(renters.operatorId, operatorId)).limit(1),
  );
  return row !== undefined;
}

export type RenterDetail = typeof renters.$inferSelect;

/** One of the Operator's Renters, or null if they are not theirs. */
export async function loadRenter(
  database: AnyDatabase,
  operatorId: string,
  renterId: string,
): Promise<RenterDetail | null> {
  const [renter] = await withTenant(database, operatorId, (tx) =>
    tx
      .select()
      .from(renters)
      .where(and(eq(renters.id, renterId), eq(renters.operatorId, operatorId))),
  );
  return renter ?? null;
}

export interface SharedContact {
  id: string;
  fullName: string;
  isArchived: boolean;
  sharesPhone: boolean;
  sharesEmail: boolean;
}

/**
 * The Operator's other Renters with the same phone or email: maybe the same
 * person entered twice, maybe family. Shown as a note, never a refusal.
 */
export async function findRentersSharingContact(
  database: AnyDatabase,
  operatorId: string,
  renter: Pick<RenterDetail, "id" | "phone" | "email">,
): Promise<SharedContact[]> {
  const sameContact = or(
    renter.phone ? eq(renters.phone, renter.phone) : undefined,
    renter.email ? eq(renters.email, renter.email) : undefined,
  );
  if (!sameContact) {
    return [];
  }
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        id: renters.id,
        fullName: renters.fullName,
        phone: renters.phone,
        email: renters.email,
        archivedAt: renters.archivedAt,
      })
      .from(renters)
      .where(and(eq(renters.operatorId, operatorId), ne(renters.id, renter.id), sameContact))
      .orderBy(asc(renters.fullName)),
  );
  return rows.map((row) => ({
    id: row.id,
    fullName: row.fullName,
    isArchived: row.archivedAt !== null,
    sharesPhone: renter.phone !== null && row.phone === renter.phone,
    sharesEmail: renter.email !== null && row.email === renter.email,
  }));
}
