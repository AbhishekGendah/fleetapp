"use client";

import { Label } from "@fleetapp/ui/input";
import { RecordPicker, type PickableRecord } from "@fleetapp/ui/record-picker";
import { useRouter } from "next/navigation";

import { calendarPath, type CalendarAddress } from "../../../lib/paths";

const EVERY_CAR = "every-car";
const EVERY_CAR_RECORD: PickableRecord = { value: EVERY_CAR, label: "All cars" };

/**
 * Which car the calendar shows: every car, or one found by typing part of
 * its rego, make or model. Choosing one opens the calendar on it, in the
 * same view and on the same month or day.
 */
export function CarFilter(props: {
  cars: readonly PickableRecord[];
  vehicleId: string | undefined;
  /** The view and month or day showing now, kept when the car changes. */
  address: Omit<CalendarAddress, "vehicleId">;
}) {
  const router = useRouter();
  return (
    <div className="flex items-center gap-2 sm:w-72">
      <Label htmlFor="calendar-car" className="shrink-0">
        Car
      </Label>
      <div className="min-w-0 flex-1">
        <RecordPicker
          id="calendar-car"
          name="car"
          records={[EVERY_CAR_RECORD, ...props.cars]}
          value={props.vehicleId ?? EVERY_CAR}
          onValueChange={(value) => {
            if (value === "" || value === (props.vehicleId ?? EVERY_CAR)) {
              return;
            }
            router.push(
              calendarPath({
                ...props.address,
                vehicleId: value === EVERY_CAR ? undefined : value,
              }),
            );
          }}
          placeholder="Type a rego or model"
          emptyMessage="No car matches that."
        />
      </div>
    </div>
  );
}
