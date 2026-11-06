import type { Metadata } from "next";
import { listQueryString, parseListQuery } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { CountLinks, type CountLink } from "@fleetapp/ui/count-links";
import { DataList } from "@fleetapp/ui/data-list";
import { CalendarDays, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { appDb } from "../../lib/app-db";
import { loadRentalBalances } from "../../lib/ledger/rental-balances";
import {
  NEW_RENTAL_PATH,
  RENTALS_CALENDAR_PATH,
  RENTALS_PATH,
  rentalsWithStatusPath,
} from "../../lib/paths";
import {
  RENTAL_LIST_STATUS_LABELS,
  RENTAL_LIST_STATUSES,
  rentalListStatusCounts,
  rentalListStatusOf,
  type RentalListStatus,
} from "../../lib/rentals/rental-list-status";
import {
  countRentalsByStatus,
  listRentalPage,
  STATUS_FILTER_KEY,
} from "../../lib/rentals/rental-queries";
import { requireUser } from "../../lib/require-user";
import { AppShell } from "../app-shell";
import { RENTAL_LIST, RentalCard, rentalListRows } from "./rental-list";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Rentals" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Shown only while there are drafts: the four agreed filters are always there. */
const SHOWN_WHEN_ANY: ReadonlySet<RentalListStatus> = new Set(["draft"]);

/** "All", then each filter with how many it holds, each opening the list filtered to it. */
function statusCountLinks(
  counts: Record<RentalListStatus, number>,
  currentStatus: string | undefined,
): CountLink[] {
  const total = RENTAL_LIST_STATUSES.reduce((sum, status) => sum + counts[status], 0);
  const byStatus = RENTAL_LIST_STATUSES.filter(
    (status) => !SHOWN_WHEN_ANY.has(status) || counts[status] > 0,
  ).map((status) => ({
    href: rentalsWithStatusPath(status),
    label: RENTAL_LIST_STATUS_LABELS[status],
    count: counts[status],
    isCurrent: currentStatus === status,
  }));
  return [
    { href: RENTALS_PATH, label: "All", count: total, isCurrent: !currentStatus },
    ...byStatus,
  ];
}

export default async function RentalsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const searchParams = await props.searchParams;
  const asked = searchParams[STATUS_FILTER_KEY];
  const status = typeof asked === "string" ? rentalListStatusOf(asked) : undefined;
  const query = parseListQuery(RENTAL_LIST, { ...searchParams, [STATUS_FILTER_KEY]: status });
  // An old address (?status=active) opens the filter that now holds it, under its new name.
  if (typeof asked === "string" && status && asked !== status) {
    redirect(`${RENTALS_PATH}${listQueryString(RENTAL_LIST, query)}`);
  }
  const clock = { timeZone: user.operatorTimezone, now: new Date() };
  const [counts, page] = await Promise.all([
    countRentalsByStatus(appDb, user.operatorId),
    listRentalPage(appDb, user.operatorId, query, { clock }),
  ]);
  const balances = await loadRentalBalances(
    appDb,
    user.operatorId,
    page.rows.map((rental) => rental.id),
  );
  const hasRentals = Object.keys(counts).length > 0;

  return (
    <AppShell user={user}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-primary text-2xl font-extrabold">Rentals</h1>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={RENTALS_CALENDAR_PATH}>
              <CalendarDays aria-hidden />
              Calendar
            </Link>
          </Button>
          <Button asChild>
            <Link href={NEW_RENTAL_PATH}>
              <Plus aria-hidden />
              New rental
            </Link>
          </Button>
        </div>
      </div>

      {hasRentals ? (
        <>
          <CountLinks
            label="Rentals by status"
            links={statusCountLinks(
              rentalListStatusCounts(counts),
              query.filters[STATUS_FILTER_KEY],
            )}
          />
          <DataList
            definition={RENTAL_LIST}
            page={{ ...page, rows: rentalListRows(page.rows, balances, clock) }}
            query={query}
            basePath={RENTALS_PATH}
            rowKey={(rental) => rental.id}
            hasRowLinksInCells
            renderCard={(rental) => <RentalCard rental={rental} />}
            itemName={{ one: "rental", many: "rentals" }}
            searchLabel="Search by Renter or rego"
            emptyMessage="No rentals match. Try a different search or filter."
          />
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No rentals yet</CardTitle>
            <CardDescription>
              Book a car for a Renter with New rental. The same car can never be booked twice for
              the same time.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </AppShell>
  );
}
