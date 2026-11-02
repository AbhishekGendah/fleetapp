import { todayInTimeZone } from "@fleetapp/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { FormDialog } from "@fleetapp/ui/form-dialog";
import { Plus } from "lucide-react";

import { appDb } from "../../../lib/app-db";
import { listCarDamage } from "../../../lib/damage/damage-queries";
import type { SignedInUser } from "../../../lib/require-user";
import type { VehicleDetail } from "../../../lib/vehicles/vehicle-queries";
import { DamageList } from "../damage-list";
import { recordFoundDamageAction } from "./damage-actions";
import { FoundDamageForm } from "./found-damage-form";

/** A car's damage, open first: from its returns, and anything found any other time. */
export async function DamageTab({ vehicle, user }: { vehicle: VehicleDetail; user: SignedInUser }) {
  const records = await listCarDamage(appDb, user.operatorId, vehicle.id);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Damage</CardTitle>
        <CardDescription>
          New damage marked at a return is added here by itself. Record anything found another way:
          a walk-round, a Renter telling you, a car park bump.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {vehicle.archivedAt ? null : (
          <FormDialog
            triggerLabel="Record damage"
            triggerIcon={<Plus aria-hidden />}
            isMainAction
            title="Record damage"
          >
            <FoundDamageForm
              action={recordFoundDamageAction.bind(null, vehicle.id)}
              today={todayInTimeZone(new Date(), user.operatorTimezone)}
            />
          </FormDialog>
        )}
        <DamageList records={records} emptyText="No damage recorded." />
      </CardContent>
    </Card>
  );
}
