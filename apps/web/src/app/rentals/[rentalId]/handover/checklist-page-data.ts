import { signerNameOf, type HandoverView } from "../../../../lib/handover/handover-queries";
import {
  HANDOVER_DETAIL_FIELDS,
  type HandoverDetailField,
} from "../../../../lib/handover/handover-input";
import { carFilePath } from "../../../../lib/paths";
import type { ChecklistData, SavedPhoto } from "./checklist-data";

/** A photo the server holds, with where its small copy shows. */
export function savedPhoto(
  vehicleId: string,
  photo: { fileId: string; thumbnailFileId: string | null },
): SavedPhoto {
  return {
    fileId: photo.fileId,
    viewUrl: carFilePath(vehicleId, photo.thumbnailFileId ?? photo.fileId),
  };
}

function detailValues(view: HandoverView): Record<HandoverDetailField, string> {
  const values: Record<HandoverDetailField, string | number | null> = {
    odometerKm: view.odometerKm,
    fuelLevel: view.fuelLevel,
    keysCount: view.keysCount,
    accessories: view.accessories,
    notes: view.notes,
  };
  return Object.fromEntries(
    HANDOVER_DETAIL_FIELDS.map((field) => [
      field,
      values[field] === null ? "" : String(values[field]),
    ]),
  ) as Record<HandoverDetailField, string>;
}

export function checklistData(
  view: HandoverView,
  checks: Pick<ChecklistData, "blockers">,
): ChecklistData {
  return {
    rentalId: view.rentalId,
    inspectionId: view.inspectionId,
    carLabel: `${view.carRego} · ${view.carMakeModel}`,
    renterName: signerNameOf(view) ?? view.renterFullName,
    photoNames: view.photoNames,
    photos: Object.fromEntries(
      [...view.photos].map(([name, photo]) => [name, savedPhoto(view.vehicleId, photo)]),
    ),
    marks: view.damageMarks.map((mark) => ({
      id: mark.id,
      x: mark.x,
      y: mark.y,
      description: mark.description,
      photo: mark.photo ? savedPhoto(view.vehicleId, mark.photo) : null,
    })),
    details: detailValues(view),
    gaps: view.gaps,
    ...checks,
  };
}
