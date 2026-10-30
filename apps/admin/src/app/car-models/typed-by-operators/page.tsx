import { AUSTRALIAN_LOCALE } from "@fleetapp/core";
import { loadVehicleCatalogue } from "@fleetapp/db/vehicle-catalogue";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { PageHeader } from "@fleetapp/ui/page-header";

import { appDb } from "../../../lib/app-db";
import { listUnlistedCars } from "../../../lib/car-models/car-model-queries";
import { CAR_MODELS_PATH } from "../../../lib/paths";
import { requireAdmin } from "../../../lib/require-admin";
import { AdminShell } from "../../admin-shell";
import { fixCarAction } from "../actions";
import { FixCarForm } from "./fix-car-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADDED_DATE = new Intl.DateTimeFormat(AUSTRALIAN_LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Australia/Perth",
});

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
                {car.operatorName} · added {ADDED_DATE.format(car.addedAt)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FixCarForm
                typed={{ make: car.make, model: car.model }}
                catalogue={catalogue}
                action={fixCarAction.bind(null, car.vehicleId)}
              />
            </CardContent>
          </Card>
        ))
      )}
    </AdminShell>
  );
}
