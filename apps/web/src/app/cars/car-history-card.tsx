import { Card, CardContent, CardHeader, CardTitle } from "@fleetapp/ui/card";

import { RecordHistory } from "../../components/record-history";
import { appDb } from "../../lib/app-db";
import { loadRecordHistory, type HistorySubject } from "../../lib/record-history";
import type { SignedInUser } from "../../lib/require-user";
import { describeVehicleValue, vehicleFieldLabel } from "../../lib/vehicles/vehicle-labels";

/** A History card for a car or its paperwork, with car fields named and valued in words. */
export async function CarHistoryCard(props: {
  user: SignedInUser;
  subjects: readonly HistorySubject[];
}) {
  const entries = await loadRecordHistory(appDb, props.user.operatorId, props.subjects);
  return (
    <Card>
      <CardHeader>
        <CardTitle>History</CardTitle>
      </CardHeader>
      <CardContent>
        <RecordHistory
          entries={entries}
          timezone={props.user.operatorTimezone}
          fieldLabel={vehicleFieldLabel}
          describeValue={(field, value) =>
            describeVehicleValue(field, value, props.user.operatorTimezone)
          }
        />
      </CardContent>
    </Card>
  );
}
