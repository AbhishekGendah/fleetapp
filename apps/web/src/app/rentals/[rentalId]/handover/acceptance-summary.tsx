import {
  acceptanceSentence,
  formatKilometres,
  FUEL_LEVEL_LABELS,
  type BusinessAcceptance,
} from "@fleetapp/core";

import { DetailLines } from "../../../../components/detail-lines";
import type { ShownChecklist } from "../../../../lib/handover/checklist-fingerprint";

/**
 * What the Renter accepts, shown on the phone before they sign: the car's
 * saved kilometres, fuel and keys, and the sentence the report keeps, made
 * by the same words (review G9-2, G9-11). The form sends its fingerprint
 * with the signature, so a change made since is refused rather than signed.
 */
export function AcceptanceSummary(props: {
  car: string;
  verb: "received" | "returned";
  atText: string;
  shown: ShownChecklist;
  /** A business's car: its driver accepts it for the business (rule 15). */
  forBusiness?: BusinessAcceptance;
}) {
  return (
    <div className="bg-muted flex flex-col gap-3 rounded-md p-3 text-sm">
      <p className="font-medium">{props.car}</p>
      <DetailLines
        lines={[
          ["Kilometres", formatKilometres(props.shown.odometerKm)],
          ["Fuel", FUEL_LEVEL_LABELS[props.shown.fuelLevel]],
          ["Keys", String(props.shown.keysCount)],
        ]}
      />
      <blockquote className="border-l-2 pl-3">
        {acceptanceSentence(props.verb, {
          atText: props.atText,
          odometerKm: props.shown.odometerKm,
          fuelLevel: props.shown.fuelLevel,
          forBusiness: props.forBusiness,
        })}
      </blockquote>
    </div>
  );
}
