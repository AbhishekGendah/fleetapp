import type { Metadata } from "next";
import { parseListQuery } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { DataList } from "@fleetapp/ui/data-list";
import { CalendarDays, GanttChart, Plus } from "lucide-react";
import Link from "next/link";

import { appDb } from "../../lib/app-db";
import {
  NEW_RENTAL_PATH,
  RENTALS_CALENDAR_PATH,
  RENTALS_PATH,
  RENTALS_TIMELINE_PATH,
  rentalPath,
} from "../../lib/paths";
import { hasAnyRental, listRentalPage } from "../../lib/rentals/rental-queries";
import { requireUser } from "../../lib/require-user";
import { AppShell } from "../app-shell";
import { rentalList } from "./rental-list";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Rentals" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RentalsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const definition = rentalList(user.operatorTimezone);
  const query = parseListQuery(definition, await props.searchParams);
  const clock = { timeZone: user.operatorTimezone, now: new Date() };
  const [hasRentals, page] = await Promise.all([
    hasAnyRental(appDb, user.operatorId),
    listRentalPage(appDb, user.operatorId, query, { clock }),
  ]);

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
          <Button asChild variant="outline">
            <Link href={RENTALS_TIMELINE_PATH}>
              <GanttChart aria-hidden />
              Timeline
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
        <DataList
          definition={definition}
          page={page}
          query={query}
          basePath={RENTALS_PATH}
          rowKey={(rental) => rental.id}
          rowHref={(rental) => rentalPath(rental.id)}
          itemName={{ one: "rental", many: "rentals" }}
          searchLabel="Search by Renter or rego"
          emptyMessage="No rentals match. Try a different search or filter."
        />
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
