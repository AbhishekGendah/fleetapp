import type { Metadata } from "next";
import { loadVehicleCatalogue } from "@fleetapp/db/vehicle-catalogue";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { PageHeader } from "@fleetapp/ui/page-header";

import { appDb } from "../../../lib/app-db";
import { listUnlistedCars } from "../../../lib/car-models/car-model-queries";
import { formatAdminDate } from "../../../lib/format";
import { CAR_MODELS_PATH } from "../../../lib/paths";
import { requireAdmin } from "../../../lib/require-admin";
import { AdminShell } from "../../admin-shell";
import { fixCarAction } from "../actions";
import { FixCarForm } from "./fix-car-form";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Typed by Operators" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cars whose make or model is not in the list, one per line: the Operator's
 * business name and the words typed, nothing else about the car.
 */
export default async function TypedByOperatorsPage() {
  await requireAdmin();
  const [cars, catalogue] = await Promise.all([
    listUnlistedCars(appDb),
    loadVehicleCatalogue(appDb),
  ]);
  const spellingKey = (car: { make: string; model: string }) => `${car.make}\n${car.model}`;
  const typedTheSameWay = new Map<string, number>();
  for (const car of cars) {
    typedTheSameWay.set(spellingKey(car), (typedTheSameWay.get(spellingKey(car)) ?? 0) + 1);
  }

  return (
    <AdminShell>
      <PageHeader backHref={CAR_MODELS_PATH} backLabel="Car models" title="Typed by Operators" />
      <p className="text-muted-foreground text-sm">
        Cars whose make or model is not in the list. Fixing one changes only that car, and shows in
        the Operator&rsquo;s history for it as a change by AGS.
      </p>
      {cars.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nothing to review: every car is in the list.
        </p>
      ) : (
        cars.map((car) => (
          <Card key={car.vehicleId}>
            <CardHeader>
              <CardTitle>
                {car.make} {car.model}
              </CardTitle>
              <CardDescription>
                {car.operatorName} · added {formatAdminDate(car.addedAt)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FixCarForm
                typed={{ make: car.make, model: car.model }}
                catalogue={catalogue}
                typedTheSameWay={typedTheSameWay.get(spellingKey(car)) ?? 1}
                action={fixCarAction.bind(null, car.vehicleId)}
              />
            </CardContent>
          </Card>
        ))
      )}
    </AdminShell>
  );
}
