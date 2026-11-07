import { MAX_EXPORT_ROWS, type ListPage, type ListQuery, type RenterStatus } from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  listConditions,
  listOrderBy,
  loadListPage,
  type DatabaseListRules,
} from "@fleetapp/db/list-query";
import { renters } from "@fleetapp/db/schema";
import type { ExportFormat } from "@fleetapp/core/spreadsheet";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, asc, count, eq, isNotNull, isNull, ne, not, or, sql, type SQL } from "drizzle-orm";

import type { ActingUser } from "../acting-user";
import { recordListExport } from "../list-export-log";
import {
  RENTER_LIST_FILTERS,
  renterListFilterOf,
  type RenterListFilter,
} from "./renter-list-status";

/** The filter value that shows archived Renters instead of current ones. */
export const ARCHIVED_FILTER_VALUE = "archived" satisfies RenterListFilter;

/**
 * True while the Renter has sent details through their link that wait for
 * review. Table names are written out: in a select list the query builder
 * leaves them off, and inside this sub-query "id" would then mean the
 * submission's.
 */
const isWaitingReview = sql<boolean>`exists (
  select 1 from "renter_submissions" "waiting"
  where "waiting"."renter_id" = "renters"."id"
    and "waiting"."operator_id" = "renters"."operator_id"
    and "waiting"."status" = 'waiting'
)`;
export const STATUS_FILTER_KEY = "status";

/** A rental of this Renter's in one of these statuses. Table names written out for the sub-query. */
function hasRentalThat(status: "active" | "booked"): SQL<boolean> {
  return sql<boolean>`exists (
    select 1 from "rentals" "theirs"
    where "theirs"."renter_id" = "renters"."id"
      and "theirs"."operator_id" = "renters"."operator_id"
      and "theirs"."status" = ${status}
  )`;
}

/** Has a car out now. */
const isRentingNow = hasRentalThat("active");
/** Has a car booked, and none out (the list says Renting for those). */
const isBookedOnly = sql<boolean>`(${hasRentalThat("booked")} and not ${isRentingNow})`;

/** When they last brought a car back, for "Last back Tue 29 Sep". */
const lastBackAt = sql<Date | null>`(
  select max("theirs"."returned_at") from "rentals" "theirs"
  where "theirs"."renter_id" = "renters"."id"
    and "theirs"."operator_id" = "renters"."operator_id"
)`.mapWith(renters.createdAt);

/** What each of the list's filters holds (archived ones apart). */
const FILTER_CONDITIONS: Readonly<Record<Exclude<RenterListFilter, "archived">, SQL>> = {
  renting: isRentingNow,
  booked: isBookedOnly,
  "to-review": isWaitingReview,
  "do-not-rent": sql`${renters.status} = 'do_not_rent'`,
};

const summaryColumns = {
  id: renters.id,
  fullName: renters.fullName,
  preferredName: renters.preferredName,
  phone: renters.phone,
  email: renters.email,
  status: renters.status,
  archivedAt: renters.archivedAt,
  licenceExpiresOn: renters.licenceExpiresOn,
  isWaitingReview,
  createdAt: renters.createdAt,
  lastBackAt,
};

export interface RenterSummary {
  id: string;
  fullName: string;
  preferredName: string | null;
  phone: string | null;
  email: string | null;
  status: RenterStatus;
  archivedAt: Date | null;
  licenceExpiresOn: string | null;
  isWaitingReview: boolean;
  /** When they were added: "with you since". */
  createdAt: Date;
  lastBackAt: Date | null;
}

/** The phone as typed without spaces, e.g. "0491570006" (phones are kept "0491 570 006"). */
const phoneDigits = sql`regexp_replace(${renters.phone}, '[^0-9]', '', 'g')`;

export const RENTER_LIST_RULES: DatabaseListRules = {
  searchIn: [
    renters.fullName,
    renters.preferredName,
    renters.phone,
    // Found as copied from a call log or text too: no spaces, or +61 (review A8-9).
    phoneDigits,
    sql`'+61' || substr(${phoneDigits}, 2)`,
    renters.email,
    renters.licenceNumber,
  ],
  sortBy: {
    name: sql`lower(${renters.fullName})`,
    licenceExpires: renters.licenceExpiresOn,
    status: renters.status,
    since: renters.createdAt,
  },
  filterBy: {
    [STATUS_FILTER_KEY]: (value) => {
      const filter = renterListFilterOf(value);
      return filter && filter !== ARCHIVED_FILTER_VALUE ? FILTER_CONDITIONS[filter] : undefined;
    },
  },
  tieBreaker: renters.id,
};

/** Current Renters unless the archived ones were asked for. */
function archivedCondition(query: ListQuery): SQL {
  return renterListFilterOf(query.filters[STATUS_FILTER_KEY]) === ARCHIVED_FILTER_VALUE
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
    await recordListExport(tx, actor, { list: "renters", format, rows: rows.length });
    return rows;
  });
}

/** How many of the Operator's Renters each of the list's filters holds, and all current ones. */
export async function countRentersByFilter(
  database: AnyDatabase,
  operatorId: string,
): Promise<Record<RenterListFilter | "all", number>> {
  const isCurrent = isNull(renters.archivedAt);
  const countWhere = (condition: SQL) =>
    sql<number>`count(*) filter (where ${condition})`.mapWith(Number);
  const [row] = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        all: countWhere(isCurrent),
        renting: countWhere(and(isCurrent, FILTER_CONDITIONS.renting)!),
        booked: countWhere(and(isCurrent, FILTER_CONDITIONS.booked)!),
        "to-review": countWhere(and(isCurrent, FILTER_CONDITIONS["to-review"])!),
        "do-not-rent": countWhere(and(isCurrent, FILTER_CONDITIONS["do-not-rent"])!),
        archived: countWhere(not(isCurrent)),
      })
      .from(renters)
      .where(eq(renters.operatorId, operatorId)),
  );
  return Object.fromEntries(
    ["all", ...RENTER_LIST_FILTERS].map((key) => [key, row?.[key as keyof typeof row] ?? 0]),
  ) as Record<RenterListFilter | "all", number>;
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
