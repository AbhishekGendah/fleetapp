import { Card, CardContent } from "@fleetapp/ui/card";
import { PageHeader } from "@fleetapp/ui/page-header";
import { redirect } from "next/navigation";

import { appDb } from "../../../../lib/app-db";
import { carPath } from "../../../../lib/paths";
import { requireUser } from "../../../../lib/require-user";
import { loadVehicleCatalogue } from "@fleetapp/db/vehicle-catalogue";
import { vehicleFormValues } from "../../../../lib/vehicles/vehicle-input";
import { AppShell } from "../../../app-shell";
import { editCarAction } from "../../actions";
import { CarForm } from "../../car-form";
import { loadCarOrNotFound } from "../load-car";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function EditCarPage(props: { params: Promise<{ vehicleId: string }> }) {
  const user = await requireUser();
  const { vehicleId } = await props.params;
  const [vehicle, catalogue] = await Promise.all([
    loadCarOrNotFound(user, vehicleId),
    loadVehicleCatalogue(appDb),
  ]);
  // An archived car is read-only until it is restored.
  if (vehicle.archivedAt) {
    redirect(carPath(vehicle.id));
  }

  return (
    <AppShell user={user}>
      <PageHeader
        backHref={carPath(vehicle.id)}
        backLabel={vehicle.rego}
        title={`Edit ${vehicle.rego}`}
      />
      <Card>
        <CardContent className="pt-4 sm:pt-6">
          <CarForm
            catalogue={catalogue}
            isNew={false}
            initialValues={vehicleFormValues(vehicle)}
            action={editCarAction.bind(null, vehicle.id)}
            submitLabel="Save changes"
            cancelHref={carPath(vehicle.id)}
          />
        </CardContent>
      </Card>
    </AppShell>
  );
}
