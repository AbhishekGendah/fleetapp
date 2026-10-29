import { Card, CardContent, CardHeader, CardTitle } from "@fleetapp/ui/card";

import { CARS_PATH } from "../../../lib/paths";
import { requireUser } from "../../../lib/require-user";
import { EMPTY_VEHICLE_FORM } from "../../../lib/vehicles/vehicle-input";
import { AppShell } from "../../app-shell";
import { addCarAction } from "../actions";
import { CarForm } from "../car-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NewCarPage() {
  const user = await requireUser();
  return (
    <AppShell user={user}>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Add a car</CardTitle>
        </CardHeader>
        <CardContent>
          <CarForm
            initialValues={EMPTY_VEHICLE_FORM}
            action={addCarAction}
            submitLabel="Add car"
            cancelHref={CARS_PATH}
          />
        </CardContent>
      </Card>
    </AppShell>
  );
}
