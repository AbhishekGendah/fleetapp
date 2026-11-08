import { createHash } from "node:crypto";

import type { HandoverView } from "./handover-queries";

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

/** Whether a posted value can be a checklist fingerprint at all. */
export function isChecklistFingerprint(value: unknown): value is string {
  return typeof value === "string" && FINGERPRINT_PATTERN.test(value);
}

/**
 * A fingerprint of everything the Renter is shown and the report prints
 * from a checklist: who signs for the car (the driver, by id and name, and
 * for a business the legal name they accept it for), its
 * details, damage marks and photos. The signing screen sends back the one it
 * showed; it is checked again under the lock that issues the report, so a
 * change made on another phone in between (or before a checklist saved
 * offline is sent) stops the signing instead of slipping past it (review
 * A6-10, G9-2, slice 3 review).
 */
export function checklistFingerprint(view: HandoverView): string {
  const shown = {
    inspectionId: view.inspectionId,
    // A business's driver accepts "for" its legal name, so that is shown too; a person's stays as it was.
    signer:
      view.renterKind === "organisation"
        ? [view.driverId, view.driverFullName, view.renterFullName]
        : [view.driverId, view.driverFullName],
    details: [view.odometerKm, view.fuelLevel, view.keysCount, view.accessories, view.notes],
    photos: [...view.photos.entries()]
      .map(([name, photo]) => [name, photo.fileId, photo.thumbnailFileId])
      .sort(([first], [second]) => String(first).localeCompare(String(second))),
    damageMarks: view.damageMarks
      .map((mark) => [mark.id, mark.x, mark.y, mark.description, mark.photo?.fileId ?? null])
      .sort(([first], [second]) => String(first).localeCompare(String(second))),
  };
  return createHash("sha256").update(JSON.stringify(shown)).digest("hex");
}

/** What the signing step shows from a checklist, as saved, with its fingerprint. */
export interface ShownChecklist {
  fingerprint: string;
  odometerKm: number;
  fuelLevel: NonNullable<HandoverView["fuelLevel"]>;
  keysCount: number;
}

/**
 * The saved details the Renter is shown before signing, never what is still
 * in the boxes (review G9-2); null until the details are saved.
 */
export function shownChecklistOf(view: HandoverView): ShownChecklist | null {
  if (view.odometerKm === null || view.fuelLevel === null || view.keysCount === null) {
    return null;
  }
  return {
    fingerprint: checklistFingerprint(view),
    odometerKm: view.odometerKm,
    fuelLevel: view.fuelLevel,
    keysCount: view.keysCount,
  };
}
