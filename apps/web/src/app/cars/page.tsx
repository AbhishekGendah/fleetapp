import type { Metadata } from "next";
import { listQueryString, parseListQuery } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { CountLinks, type CountLink } from "@fleetapp/ui/count-links";
import { DataList } from "@fleetapp/ui/data-list";
import { Plus, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { appDb } from "../../lib/app-db";
import {
  CARS_EXPORT_PATH,
  CARS_PATH,
  carsWithStatusPath,
  INSURANCE_PATH,
  NEW_CAR_PATH,
} from "../../lib/paths";
import { requireUser } from "../../lib/require-user";
import {
  CAR_FILTERS_SHOWN_WHEN_ANY,
  CAR_LIST_FILTER_LABELS,
  CAR_LIST_FILTERS,
  carListFilterOf,
  type CarListFilter,
} from "../../lib/vehicles/car-list-filters";
import { carListRows } from "../../lib/vehicles/car-list-rows";
import { loadCarRentalsNow } from "../../lib/vehicles/car-rentals-now";
import { loadExpiryContext } from "../../lib/vehicles/expiry-context";
import {
  countCarsByFilter,
  listVehiclePage,
  STATUS_FILTER_KEY,
} from "../../lib/vehicles/vehicle-queries";
import { AppShell } from "../app-shell";
import { CAR_LIST, CarCard } from "./car-list";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Cars" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "All", then each filter with how many it holds; Sold and Written off only while there are any. */
function filterCountLinks(
  counts: Record<CarListFilter | "all", number>,
  current: string | undefined,
): CountLink[] {
  const byFilter = CAR_LIST_FILTERS.filter(
    (filter) => !CAR_FILTERS_SHOWN_WHEN_ANY.has(filter) || counts[filter] > 0,
  ).map((filter) => ({
    href: carsWithStatusPath(filter),
    label: CAR_LIST_FILTER_LABELS[filter],
    count: counts[filter],
    isCurrent: current === filter,
  }));
  return [{ href: CARS_PATH, label: "All", count: counts.all, isCurrent: !current }, ...byFilter];
}

export default async function CarsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const searchParams = await props.searchParams;
  const asked = searchParams[STATUS_FILTER_KEY];
  const filter = typeof asked === "string" ? carListFilterOf(asked) : undefined;
  const query = parseListQuery(CAR_LIST, { ...searchParams, [STATUS_FILTER_KEY]: filter });
  // An old address (?status=rented) opens the filter that now holds it, under its new name.
  if (typeof asked === "string" && filter && asked !== filter) {
    redirect(`${CARS_PATH}${listQueryString(CAR_LIST, query)}`);
  }
  const clock = { timeZone: user.operatorTimezone, now: new Date() };
  const [counts, page, expiry] = await Promise.all([
    countCarsByFilter(appDb, user.operatorId),
    listVehiclePage(appDb, user.operatorId, query),
    loadExpiryContext(user),
  ]);
  const rentalsByCar = await loadCarRentalsNow(
    appDb,
    user.operatorId,
    page.rows.map((car) => car.id),
    clock,
  );
  const hasCars = counts.all + counts.archived > 0;
  const queryString = listQueryString(CAR_LIST, query, { page: 1 });

  return (
    <AppShell user={user}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-primary text-2xl font-extrabold">Cars</h1>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={INSURANCE_PATH}>
              <ShieldCheck aria-hidden />
              Insurance
            </Link>
          </Button>
          <Button asChild>
            <Link href={NEW_CAR_PATH}>
              <Plus aria-hidden />
              Add car
            </Link>
          </Button>
        </div>
      </div>

      {hasCars ? (
        <>
          <CountLinks label="Cars by status" links={filterCountLinks(counts, filter)} />
          <DataList
            definition={CAR_LIST}
            page={{ ...page, rows: carListRows(page.rows, rentalsByCar, expiry, clock) }}
            query={query}
            basePath={CARS_PATH}
            rowKey={(vehicle) => vehicle.id}
            hasRowLinksInCells
            renderCard={(vehicle) => <CarCard vehicle={vehicle} />}
            itemName={{ one: "car", many: "cars" }}
            searchLabel="Search by rego, make or model"
            exportHrefs={{
              csv: `${CARS_EXPORT_PATH}/csv${queryString}`,
              xlsx: `${CARS_EXPORT_PATH}/xlsx${queryString}`,
            }}
            emptyMessage="No cars match. Try a different search or filter."
          />
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No cars yet</CardTitle>
            <CardDescription>
              Add your first car with its rego, make, model and year. You can add the rest later.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </AppShell>
  );
}
