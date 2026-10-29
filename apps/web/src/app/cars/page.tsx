import { listQueryString, parseListQuery } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { DataList } from "@fleetapp/ui/data-list";
import Link from "next/link";

import { appDb } from "../../lib/app-db";
import {
  CARS_EXPORT_PATH,
  CARS_PATH,
  carPath,
  INSURANCE_PATH,
  NEW_CAR_PATH,
} from "../../lib/paths";
import { requireUser } from "../../lib/require-user";
import { withExpiryStatuses } from "../../lib/vehicles/expiry-columns";
import { loadExpiryContext } from "../../lib/vehicles/expiry-context";
import { hasAnyVehicle, listVehiclePage } from "../../lib/vehicles/vehicle-queries";
import { AppShell } from "../app-shell";
import { CAR_LIST } from "./car-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function CarsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const query = parseListQuery(CAR_LIST, await props.searchParams);
  const [hasCars, page, expiry] = await Promise.all([
    hasAnyVehicle(appDb, user.operatorId),
    listVehiclePage(appDb, user.operatorId, query),
    loadExpiryContext(user),
  ]);
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
        <DataList
          definition={CAR_LIST}
          page={{ ...page, rows: withExpiryStatuses(page.rows, expiry) }}
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
