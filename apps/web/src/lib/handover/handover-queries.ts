import {
  handoverGaps,
  type FuelLevel,
  type HandoverGap,
  type InspectionKind,
  type InspectionStatus,
} from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  files,
  inspectionDamageMarks,
  inspections,
  rentals,
  renters,
  vehicles,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, asc, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { latestKilometres } from "../vehicles/odometer";

/** A photo on the checklist, and its small copy for showing it. */
export interface ChecklistPhoto {
  fileId: string;
  thumbnailFileId: string | null;
}

export interface DamageMarkView {
  id: string;
  x: number;
  y: number;
  description: string;
  photo: ChecklistPhoto | null;
}

/** A handover checklist as its screen, its completion and its report need it. */
export interface HandoverView {
  inspectionId: string;
  kind: InspectionKind;
  status: InspectionStatus;
  rentalId: string;
  vehicleId: string;
  renterId: string;
  renterFullName: string;
  renterEmail: string | null;
  carRego: string;
  carMakeModel: string;
  bondCents: number;
  plannedStart: Date;
  plannedEnd: Date | null;
  /** When the car went out; null until the handover is accepted. */
  handedOverAt: Date | null;
  settingsSnapshot: Record<string, unknown>;
  photoNames: string[];
  photos: ReadonlyMap<string, ChecklistPhoto>;
  odometerKm: number | null;
  fuelLevel: FuelLevel | null;
  keysCount: number | null;
  accessories: string | null;
  notes: string | null;
  damageMarks: DamageMarkView[];
  /** The car's last counted reading, for the kilometres box's check. */
  lastKilometres: number | null;
  gaps: HandoverGap[];
}

type CheckedPhotoRow = {
  id: string;
  inspectionPhotoName: string | null;
  damageMarkId: string | null;
  thumbnailOfFileId: string | null;
};

/** The checklist's photos in use, and their small copies, newest first. */
async function checklistPhotos(
  tx: AnyTransaction,
  operatorId: string,
  inspectionId: string,
): Promise<CheckedPhotoRow[]> {
  const photos = await tx
    .select({
      id: files.id,
      inspectionPhotoName: files.inspectionPhotoName,
      damageMarkId: files.damageMarkId,
      thumbnailOfFileId: files.thumbnailOfFileId,
    })
    .from(files)
    .where(
      and(
        eq(files.operatorId, operatorId),
        eq(files.inspectionId, inspectionId),
        isNotNull(files.confirmedAt),
        isNull(files.deletedAt),
      ),
    )
    .orderBy(desc(files.createdAt));
  const photoIds = photos.map((photo) => photo.id);
  const thumbnails =
    photoIds.length === 0
      ? []
      : await tx
          .select({
            id: files.id,
            inspectionPhotoName: files.inspectionPhotoName,
            damageMarkId: files.damageMarkId,
            thumbnailOfFileId: files.thumbnailOfFileId,
          })
          .from(files)
          .where(
            and(
              eq(files.operatorId, operatorId),
              inArray(files.thumbnailOfFileId, photoIds),
              isNotNull(files.confirmedAt),
              isNull(files.deletedAt),
            ),
          );
  return [...photos, ...thumbnails];
}

function photoFor(rows: readonly CheckedPhotoRow[], photoId: string): ChecklistPhoto {
  const thumbnail = rows.find((row) => row.thumbnailOfFileId === photoId);
  return { fileId: photoId, thumbnailFileId: thumbnail?.id ?? null };
}

/** Each name on the list with its photo in use (the newest, should two ever be). */
function listedPhotos(rows: readonly CheckedPhotoRow[]): Map<string, ChecklistPhoto> {
  const photos = new Map<string, ChecklistPhoto>();
  for (const photo of rows) {
    if (photo.inspectionPhotoName !== null && !photos.has(photo.inspectionPhotoName)) {
      photos.set(photo.inspectionPhotoName, photoFor(rows, photo.id));
    }
  }
  return photos;
}

/** The damage marks still on the outline, oldest first, each with its photo if taken. */
async function damageMarkViews(
  tx: AnyTransaction,
  operatorId: string,
  inspectionId: string,
  rows: readonly CheckedPhotoRow[],
): Promise<DamageMarkView[]> {
  const marks = await tx
    .select()
    .from(inspectionDamageMarks)
    .where(
      and(
        eq(inspectionDamageMarks.operatorId, operatorId),
        eq(inspectionDamageMarks.inspectionId, inspectionId),
        isNull(inspectionDamageMarks.removedAt),
      ),
    )
    .orderBy(asc(inspectionDamageMarks.createdAt));
  return marks.map((mark) => {
    const photo = rows.find((file) => file.damageMarkId === mark.id);
    return {
      id: mark.id,
      x: mark.x,
      y: mark.y,
      description: mark.description,
      photo: photo ? photoFor(rows, photo.id) : null,
    };
  });
}

/** One of the Operator's handover checklists, with everything on it; null if not theirs. */
/** A handover checklist, if it is this Operator's. */
export function loadHandover(
  database: AnyDatabase,
  operatorId: string,
  inspectionId: string,
): Promise<HandoverView | null> {
  return loadChecklist(database, operatorId, inspectionId, "handover");
}

/** A return checklist, if it is this Operator's. */
export function loadReturn(
  database: AnyDatabase,
  operatorId: string,
  inspectionId: string,
): Promise<HandoverView | null> {
  return loadChecklist(database, operatorId, inspectionId, "return");
}

async function loadChecklist(
  database: AnyDatabase,
  operatorId: string,
  inspectionId: string,
  kind: InspectionKind,
): Promise<HandoverView | null> {
  return withTenant(database, operatorId, async (tx) => {
    const [row] = await tx
      .select({
        inspection: inspections,
        renterId: rentals.renterId,
        bondCents: rentals.bondCents,
        plannedStart: rentals.plannedStart,
        plannedEnd: rentals.plannedEnd,
        handedOverAt: rentals.handedOverAt,
        settingsSnapshot: rentals.settingsSnapshot,
        renterFullName: renters.fullName,
        renterEmail: renters.email,
        carRego: vehicles.rego,
        make: vehicles.make,
        model: vehicles.model,
      })
      .from(inspections)
      .innerJoin(rentals, eq(rentals.id, inspections.rentalId))
      .innerJoin(renters, eq(renters.id, rentals.renterId))
      .innerJoin(vehicles, eq(vehicles.id, inspections.vehicleId))
      .where(
        and(
          eq(inspections.id, inspectionId),
          eq(inspections.operatorId, operatorId),
          eq(inspections.kind, kind),
        ),
      );
    if (!row) {
      return null;
    }
    const { inspection } = row;
    const rows = await checklistPhotos(tx, operatorId, inspectionId);
    const photos = listedPhotos(rows);
    const damageMarks = await damageMarkViews(tx, operatorId, inspectionId, rows);
    const progress = {
      photoNames: inspection.photoNames,
      photosTaken: new Set(photos.keys()),
      odometerKm: inspection.odometerKm,
      fuelLevel: inspection.fuelLevel,
      keysCount: inspection.keysCount,
      damageMarks: damageMarks.map((mark) => ({ hasPhoto: mark.photo !== null })),
    };
    return {
      inspectionId,
      kind: inspection.kind,
      status: inspection.status,
      rentalId: inspection.rentalId,
      vehicleId: inspection.vehicleId,
      renterId: row.renterId,
      renterFullName: row.renterFullName,
      renterEmail: row.renterEmail,
      carRego: row.carRego,
      carMakeModel: `${row.make} ${row.model}`,
      bondCents: row.bondCents,
      plannedStart: row.plannedStart,
      plannedEnd: row.plannedEnd,
      handedOverAt: row.handedOverAt,
      settingsSnapshot: row.settingsSnapshot,
      photoNames: inspection.photoNames,
      photos,
      odometerKm: inspection.odometerKm,
      fuelLevel: inspection.fuelLevel,
      keysCount: inspection.keysCount,
      accessories: inspection.accessories,
      notes: inspection.notes,
      damageMarks,
      lastKilometres: await latestKilometres(tx, inspection.vehicleId),
      gaps: handoverGaps(progress),
    };
  });
}

/** The rental's handover: the one under way, or the one finished, if either. */
export interface RentalHandoverStatus {
  inProgressId: string | null;
  completedAt: Date | null;
}

export async function loadRentalHandoverStatus(
  database: AnyDatabase,
  operatorId: string,
  rentalId: string,
  kind: InspectionKind = "handover",
): Promise<RentalHandoverStatus> {
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        id: inspections.id,
        status: inspections.status,
        completedAt: inspections.completedAt,
      })
      .from(inspections)
      .where(
        and(
          eq(inspections.operatorId, operatorId),
          eq(inspections.rentalId, rentalId),
          eq(inspections.kind, kind),
          inArray(inspections.status, ["in_progress", "completed"]),
        ),
      ),
  );
  return {
    inProgressId: rows.find((row) => row.status === "in_progress")?.id ?? null,
    completedAt: rows.find((row) => row.status === "completed")?.completedAt ?? null,
  };
}

/** The rental's finished handover, to compare the return with; null if it has none. */
export async function loadCompletedHandover(
  database: AnyDatabase,
  operatorId: string,
  rentalId: string,
): Promise<HandoverView | null> {
  const [handover] = await withTenant(database, operatorId, (tx) =>
    tx
      .select({ id: inspections.id })
      .from(inspections)
      .where(
        and(
          eq(inspections.operatorId, operatorId),
          eq(inspections.rentalId, rentalId),
          eq(inspections.kind, "handover"),
          eq(inspections.status, "completed"),
        ),
      ),
  );
  return handover ? loadHandover(database, operatorId, handover.id) : null;
}
