import { HistoryCard } from "../../components/history-card";
import type { HistorySubject } from "../../lib/record-history";
import type { SignedInUser } from "../../lib/require-user";
import { describeVehicleValue, vehicleFieldLabel } from "../../lib/vehicles/vehicle-labels";

/** A Log card for a car or its paperwork, with car fields named and valued in words. */
export function CarHistoryCard(props: { user: SignedInUser; subjects: readonly HistorySubject[] }) {
  return (
    <HistoryCard
      user={props.user}
      subjects={props.subjects}
      fieldLabel={vehicleFieldLabel}
      describeValue={describeVehicleValue}
    />
  );
}
