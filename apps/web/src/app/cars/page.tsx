import type { Metadata } from "next";
import {
  listQueryString,
  parseListQuery,
  VEHICLE_STATUS_LABELS,
  VEHICLE_STATUSES,
  type VehicleStatus,
} from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { CountLinks, type CountLink } from "@fleetapp/ui/count-links";
import { DataList } from "@fleetapp/ui/data-list";
import Link from "next/link";

import { appDb } from "../../lib/app-db";
import {
  CARS_EXPORT_PATH,
  CARS_PATH,
  carPath,
  carsWithStatusPath,
  INSURANCE_PATH,
  NEW_CAR_PATH,
} from "../../lib/paths";
import { requireUser } from "../../lib/require-user";
import { carListRows } from "../../lib/vehicles/car-list-rows";
import { loadExpiryContext } from "../../lib/vehicles/expiry-context";
import { loadFleetCounts } from "../../lib/dashboard/fleet-overview";
import {
  hasAnyVehicle,
  listVehiclePage,
  STATUS_FILTER_KEY,
} from "../../lib/vehicles/vehicle-queries";
import { AppShell } from "../app-shell";
import { CAR_LIST } from "./car-list";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Cars" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "All", then each status the Operator has cars in, each opening the list filtered to it. */
function statusCountLinks(
  counts: Partial<Record<VehicleStatus, number>>,
  currentStatus: string | undefined,
): CountLink[] {
  const total = Object.values(counts).reduce((sum, count) => sum + (count ?? 0), 0);
  const byStatus = VEHICLE_STATUSES.filter((status) => (counts[status] ?? 0) > 0).map((status) => ({
    href: carsWithStatusPath(status),
    label: VEHICLE_STATUS_LABELS[status],
    count: counts[status] ?? 0,
    isCurrent: currentStatus === status,
  }));
  return [{ href: CARS_PATH, label: "All", count: total, isCurrent: !currentStatus }, ...byStatus];
}

export default async function CarsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const query = parseListQuery(CAR_LIST, await props.searchParams);
  const [hasCars, page, expiry, counts] = await Promise.all([
    hasAnyVehicle(appDb, user.operatorId),
    listVehiclePage(appDb, user.operatorId, query),
    loadExpiryContext(user),
    loadFleetCounts(appDb, user.operatorId),
  ]);
  const clock = { timeZone: user.operatorTimezone, now: new Date() };
  const queryString = listQueryString(CAR_LIST, query, { page: 1 });

  return (
    <AppShell user={user}>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-primary text-2xl font-extrabold">Cars</h1>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={INSURANCE_PATH}>Insurance</Link>
          </Button>
          <Button asChild>
            <Link href={NEW_CAR_PATH}>Add a car</Link>
          </Button>
        </div>
      </div>

      {hasCars ? (
        <CountLinks
          label="Cars by status"
          links={statusCountLinks(counts, query.filters[STATUS_FILTER_KEY])}
        />
      ) : null}

      {hasCars ? (
        <DataList
          definition={CAR_LIST}
          page={{ ...page, rows: carListRows(page.rows, expiry, clock) }}
          query={query}
          basePath={CARS_PATH}
          rowKey={(vehicle) => vehicle.id}
          rowHref={(vehicle) => carPath(vehicle.id)}
          itemName={{ one: "car", many: "cars" }}
          searchLabel="Search by rego, make, model or colour"
          exportHrefs={{
            csv: `${CARS_EXPORT_PATH}/csv${queryString}`,
            xlsx: `${CARS_EXPORT_PATH}/xlsx${queryString}`,
          }}
          emptyMessage="No cars match. Try a different search or filter."
        />
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
