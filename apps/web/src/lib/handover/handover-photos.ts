import { inspectionDamageMarks, inspections } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, isNull } from "drizzle-orm";

import {
  startCarPhotoUpload,
  type CarPhotoUploadStart,
  type ChecklistPhotoLinks,
  type PlannedFile,
} from "../files/car-files";
import type { FileDependencies } from "../files/stored-files";
import type { ActingUser } from "../acting-user";

/** Which photo is being taken: one on the checklist's list, or a damage mark's. */
export type ChecklistPhotoTarget = { photoName: string } | { damageMarkId: string };

/**
 * The car and the file links for a photo of a checklist still under way:
 * a name on its list, or one of its damage marks still on the outline.
 */
async function checklistPhotoLinks(
  deps: FileDependencies,
  operatorId: string,
  inspectionId: string,
  target: ChecklistPhotoTarget,
): Promise<{ vehicleId: string; links: ChecklistPhotoLinks } | null> {
  return withTenant(deps.database, operatorId, async (tx) => {
    const [inspection] = await tx
      .select({ vehicleId: inspections.vehicleId, photoNames: inspections.photoNames })
      .from(inspections)
      .where(
        and(
          eq(inspections.id, inspectionId),
          eq(inspections.operatorId, operatorId),
          eq(inspections.status, "in_progress"),
        ),
      );
    if (!inspection) {
      return null;
    }
    if ("photoName" in target) {
      return inspection.photoNames.includes(target.photoName)
        ? {
            vehicleId: inspection.vehicleId,
            links: { inspectionId, inspectionPhotoName: target.photoName },
          }
        : null;
    }
    const [mark] = await tx
      .select({ id: inspectionDamageMarks.id })
      .from(inspectionDamageMarks)
      .where(
        and(
          eq(inspectionDamageMarks.id, target.damageMarkId),
          eq(inspectionDamageMarks.operatorId, operatorId),
          eq(inspectionDamageMarks.inspectionId, inspectionId),
          isNull(inspectionDamageMarks.removedAt),
        ),
      );
    return mark
      ? { vehicleId: inspection.vehicleId, links: { inspectionId, damageMarkId: mark.id } }
      : null;
  });
}

/**
 * Starts sending a checklist photo and its small copy: a car photo like any
 * other (named, shown on the car's Photos tab), tied to its place on the
 * checklist. Taking it again replaces the earlier one once it arrives.
 */
export async function startChecklistPhotoUpload(
  deps: FileDependencies,
  actor: ActingUser,
  inspectionId: string,
  target: ChecklistPhotoTarget,
  planned: { photo: PlannedFile; thumbnail: PlannedFile },
  timeZone: string,
): Promise<CarPhotoUploadStart> {
  const place = await checklistPhotoLinks(deps, actor.operatorId, inspectionId, target);
  if (!place) {
    return { status: "not_found" };
  }
  return startCarPhotoUpload(deps, actor, place.vehicleId, planned, timeZone, place.links);
}
