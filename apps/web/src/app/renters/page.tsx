import type { Metadata } from "next";
import { listQueryString, parseListQuery } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { CountLinks, type CountLink } from "@fleetapp/ui/count-links";
import { DataList } from "@fleetapp/ui/data-list";
import { Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { appDb } from "../../lib/app-db";
import { NEW_RENTER_PATH, RENTERS_EXPORT_PATH, RENTERS_PATH } from "../../lib/paths";
import { requireUser } from "../../lib/require-user";
import { loadRenterListExtras } from "../../lib/renters/renter-list-extras";
import { renterListRows } from "../../lib/renters/renter-list-rows";
import {
  RENTER_LIST_FILTER_LABELS,
  RENTER_LIST_FILTERS,
  renterListFilterOf,
  type RenterListFilter,
} from "../../lib/renters/renter-list-status";
import {
  countRentersByFilter,
  listRenterPage,
  STATUS_FILTER_KEY,
} from "../../lib/renters/renter-queries";
import { loadExpiryContext } from "../../lib/vehicles/expiry-context";
import { AppShell } from "../app-shell";
import { RENTER_LIST, RenterCard } from "./renter-list";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Renters" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rentersWithStatusPath(filter: RenterListFilter): string {
  return `${RENTERS_PATH}?${new URLSearchParams({ [STATUS_FILTER_KEY]: filter })}`;
}

/** "All", then each filter with how many it holds, each opening the list filtered to it. */
function filterCountLinks(
  counts: Record<RenterListFilter | "all", number>,
  current: string | undefined,
): CountLink[] {
  return [
    { href: RENTERS_PATH, label: "All", count: counts.all, isCurrent: !current },
    ...RENTER_LIST_FILTERS.map((filter) => ({
      href: rentersWithStatusPath(filter),
      label: RENTER_LIST_FILTER_LABELS[filter],
      count: counts[filter],
      isCurrent: current === filter,
    })),
  ];
}

export default async function RentersPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const searchParams = await props.searchParams;
  const asked = searchParams[STATUS_FILTER_KEY];
  const filter = typeof asked === "string" ? renterListFilterOf(asked) : undefined;
  const query = parseListQuery(RENTER_LIST, {
    ...searchParams,
    [STATUS_FILTER_KEY]: filter || undefined,
  });
  // An old address (?status=waiting_review) opens the filter that now holds it, under its new name.
  if (typeof asked === "string" && filter !== undefined && asked !== filter) {
    redirect(`${RENTERS_PATH}${listQueryString(RENTER_LIST, query)}`);
  }
  const clock = { timeZone: user.operatorTimezone, now: new Date() };
  const [counts, page, licenceExpiry] = await Promise.all([
    countRentersByFilter(appDb, user.operatorId),
    listRenterPage(appDb, user.operatorId, query),
    loadExpiryContext(user, "licenceExpiryWarningDays"),
  ]);
  const extras = await loadRenterListExtras(
    appDb,
    user.operatorId,
    page.rows.map((renter) => renter.id),
    clock,
  );
  const hasRenters = counts.all + counts.archived > 0;
  const queryString = listQueryString(RENTER_LIST, query, { page: 1 });

  return (
    <AppShell user={user}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-primary text-2xl font-extrabold">Renters</h1>
        <Button asChild>
          <Link href={NEW_RENTER_PATH}>
            <Plus aria-hidden />
            Add Renter
          </Link>
        </Button>
      </div>

      {hasRenters ? (
        <>
          <CountLinks
            label="Renters by status"
            links={filterCountLinks(counts, query.filters[STATUS_FILTER_KEY])}
          />
          <DataList
            definition={RENTER_LIST}
            page={{ ...page, rows: renterListRows(page.rows, extras, licenceExpiry, clock) }}
            query={query}
            basePath={RENTERS_PATH}
            rowKey={(renter) => renter.id}
            hasRowLinksInCells
            renderCard={(renter) => <RenterCard renter={renter} />}
            itemName={{ one: "Renter", many: "Renters" }}
            searchLabel="Search by name, phone or email"
            exportHrefs={{
              csv: `${RENTERS_EXPORT_PATH}/csv${queryString}`,
              xlsx: `${RENTERS_EXPORT_PATH}/xlsx${queryString}`,
            }}
            emptyMessage="No Renters match. Try a different search or filter."
          />
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No Renters yet</CardTitle>
            <CardDescription>
              Add your first Renter with their name and a phone or email. You can add the rest
              later.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </AppShell>
  );
}
