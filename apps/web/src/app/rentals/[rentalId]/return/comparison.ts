import { FUEL_LEVEL_LABELS } from "@fleetapp/core";

import type { HandoverView } from "../../../../lib/handover/handover-queries";
import { savedPhoto } from "../handover/checklist-page-data";
import type { HandoverComparison } from "../handover/handover-checklist";

/** What the handover found, for each step of the return to show beside it. */
export function comparisonWith(handover: HandoverView): HandoverComparison {
  return {
    photos: Object.fromEntries(
      [...handover.photos].map(([name, photo]) => [name, savedPhoto(handover.vehicleId, photo)]),
    ),
    marks: handover.damageMarks.map((mark) => ({
      id: mark.id,
      x: mark.x,
      y: mark.y,
      description: mark.description,
      photo: mark.photo ? savedPhoto(handover.vehicleId, mark.photo) : null,
    })),
    fuelLabel: handover.fuelLevel ? FUEL_LEVEL_LABELS[handover.fuelLevel] : null,
  };
}
