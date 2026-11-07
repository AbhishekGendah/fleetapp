import { formatDateTimeInTimeZone, formatKilometres } from "@fleetapp/core";
import type { OdometerSource } from "@fleetapp/db/schema";
import { ActionButton } from "@fleetapp/ui/action-button";
import { Badge } from "@fleetapp/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, SectionLabel } from "@fleetapp/ui/card";
import { FormDialog } from "@fleetapp/ui/form-dialog";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";
import { Plus, Undo2 } from "lucide-react";

import type { VehicleDetail } from "../../../lib/vehicles/vehicle-queries";
import { recordReadingAction, withdrawReadingAction } from "./actions";
import { OdometerForm } from "./odometer-form";

/** Where a reading came from, after its time: "typed in", "at a handover". */
const SOURCE_WORDS: Readonly<Record<OdometerSource, string>> = {
  purchase: "when the car was added",
  handover: "at a handover",
  return: "at a return",
  service: "at a service",
  renter: "from the Renter",
  manual: "typed in",
};

/** A car's odometer readings, newest first: add one, or withdraw one entered by mistake. */
export function OdometerTab({ vehicle, timezone }: { vehicle: VehicleDetail; timezone: string }) {
  return (
    <>
      <Card>
        <CardHeader>
          <SectionLabel>Readings</SectionLabel>
          <CardDescription>
            A reading lower than the last is refused unless the odometer was replaced. Withdraw one
            entered by mistake; it stays on record, crossed out.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {vehicle.archivedAt ? null : (
            <FormDialog
              triggerLabel="Add a reading"
              triggerIcon={<Plus aria-hidden />}
              isMainAction
              title="Add an odometer reading"
            >
              <OdometerForm action={recordReadingAction.bind(null, vehicle.id)} />
            </FormDialog>
          )}
          {vehicle.readings.length === 0 ? (
            <p className="text-muted-foreground text-sm">No readings yet.</p>
          ) : (
            <RecordList label="Readings">
              {vehicle.readings.map((reading) => (
                <RecordItem
                  key={reading.id}
                  className={reading.withdrawnAt ? "text-muted-foreground" : undefined}
                  title={
                    <span className={reading.withdrawnAt ? "line-through" : undefined}>
                      {formatKilometres(reading.kilometres)}
                    </span>
                  }
                  aside={
                    reading.withdrawnAt ? (
                      <Badge>Withdrawn</Badge>
                    ) : reading.isDrop ? (
                      <Badge tone="attention">Lower than before</Badge>
                    ) : null
                  }
                  details={
                    <p>
                      {formatDateTimeInTimeZone(reading.recordedAt, timezone)} ·{" "}
                      {SOURCE_WORDS[reading.source]}
                    </p>
                  }
                  actions={
                    reading.withdrawnAt || vehicle.archivedAt ? undefined : (
                      <ActionButton
                        action={withdrawReadingAction.bind(null, vehicle.id, reading.id)}
                        label="Withdraw"
                        pendingLabel="Withdrawing…"
                        variant="danger"
                        icon={<Undo2 aria-hidden />}
                      />
                    )
                  }
                />
              ))}
            </RecordList>
          )}
        </CardContent>
      </Card>
    </>
  );
}
