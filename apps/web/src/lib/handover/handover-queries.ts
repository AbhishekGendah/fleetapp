import {
  handoverGaps,
  renterShownName,
  type BusinessAcceptance,
  type RenterKind,
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
  possessions,
  rentals,
  renters,
  vehicles,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";

import {
  rentalDriverChangePath,
  rentalHandoverPath,
  rentalReturnPath,
  rentalSwapPath,
} from "../paths";
import { latestKilometres } from "../vehicles/odometer";
import { latestHandoverOf } from "./handover-records";

/**
 * Who signs a checklist for the car (rule 15), from the possession records
 * rather than the rental's driver now (slice 4: the driver can change while
 * the car is out): the driver whose possession it started or ended; for a
 * driver change's handover still under way, the new driver; for any other
 * checklist under way while the car is out (a return, a swap's pair, a
 * driver change's check-in), the driver who has it; otherwise (a first
 * handover) the rental's driver, the Renter for a person, none while a
 * business's is to be named.
 */
const checklistDriverId = sql<string | null>`coalesce(
  (select "held"."driver_id" from "possessions" "held"
    where "held"."operator_id" = "inspections"."operator_id"
      and "held"."handover_inspection_id" = "inspections"."id"),
  (select "held"."driver_id" from "possessions" "held"
    where "held"."operator_id" = "inspections"."operator_id"
      and "held"."return_inspection_id" = "inspections"."id"),
  (select "change"."to_driver_id" from "rental_driver_changes" "change"
    where "change"."operator_id" = "inspections"."operator_id"
      and "change"."handover_inspection_id" = "inspections"."id"
      and "change"."status" = 'in_progress'),
  (select "held"."driver_id" from "possessions" "held"
    where "held"."operator_id" = "inspections"."operator_id"
      and "held"."rental_id" = "inspections"."rental_id" and "held"."ended_at" is null
      and "inspections"."status" = 'in_progress' and "inspections"."kind" = 'return'),
  (select "held"."driver_id" from "possessions" "held"
    where "held"."operator_id" = "inspections"."operator_id"
      and "held"."rental_id" = "inspections"."rental_id" and "held"."ended_at" is null
      and "inspections"."status" = 'in_progress' and "inspections"."is_for_swap"),
  "rentals"."driver_id"
)`;

/** One of the checklist's driver's columns; none while a business's is to be named. */
function driverColumn(column: "full_name" | "email") {
  return sql<string | null>`(
    select "driver".${sql.identifier(column)} from "renters" "driver"
    where "driver"."id" = ${checklistDriverId} and "driver"."operator_id" = "inspections"."operator_id"
  )`;
}

/**
 * Where a checklist's photos are: its own, but a driver change's handover
 * shows the car as it was checked in a moment before (rule 21: each photo
 * stored once), so it has the check-in's.
 */
const photoChecklistId = sql<string>`coalesce((
  select "change"."return_inspection_id" from "rental_driver_changes" "change"
  where "change"."operator_id" = "inspections"."operator_id"
    and "change"."handover_inspection_id" = "inspections"."id"
), "inspections"."id")`;

/** A photo on the checklist, and its small copy for showing it. */
export interface ChecklistPhoto {
  fileId: string;
  thumbnailFileId: string | null;
}

export interface DamageMarkView {
  id: string;
  /**
   * The mark whose photo this is: the mark itself, or for a mark a driver
   * change copied onto the new driver's checklist, the one it was copied from
   * (kept in its key), so the photo stays stored once (rule 21).
   */
  photoMarkId: string;
  x: number;
  y: number;
  description: string;
  photo: ChecklistPhoto | null;
}

/** A handover checklist as its screen, its completion and its report need it. */
export interface HandoverView {
  /** One of a car swap's pair: finished only with the swap. */
  isForSwap: boolean;
  /** One of a driver change's pair: finished only with the change. */
  isForDriverChange: boolean;
  inspectionId: string;
  kind: InspectionKind;
  status: InspectionStatus;
  rentalId: string;
  vehicleId: string;
  /** Who pays: the rental's Renter. */
  renterId: string;
  /** Who has the car and signs for it (rule 15); none while a business's driver is still to be named. */
  driverId: string | null;
  /** The Renter's full name, or a business's legal name. */
  renterFullName: string;
  renterEmail: string | null;
  renterKind: RenterKind;
  /** What the business is called, for a business Renter: its trading name, else its legal name. */
  renterShownName: string;
  /** Who greets an email to the Renter: a business's contact, else the Renter. */
  renterGreetingName: string;
  /** The driver's full name: the Renter's own for a person; none while a business's is to be named. */
  driverFullName: string | null;
  driverEmail: string | null;
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
function checklistPhotos(
  tx: AnyTransaction,
  operatorId: string,
  inspectionId: string,
): Promise<CheckedPhotoRow[]> {
  return photosInUse(tx, operatorId, eq(files.inspectionId, inspectionId));
}

/** The photos in use that match, and their small copies, newest first. */
async function photosInUse(
  tx: AnyTransaction,
  operatorId: string,
  matching: SQL,
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
        matching,
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

/**
 * The damage marks still on the outline, oldest first, each with its photo
 * if taken. A driver change's handover has no marks of its own: those on it
 * were copied from the car as it was checked in, each keeping the mark it
 * came from in its key, so its photo is found from that mark's.
 */
async function damageMarkViews(
  tx: AnyTransaction,
  operatorId: string,
  checklist: { inspectionId: string; isCopiedFromCheckIn: boolean },
  rows: readonly CheckedPhotoRow[],
): Promise<DamageMarkView[]> {
  const { inspectionId } = checklist;
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
  const photoMarkIdOf = (mark: (typeof marks)[number]): string =>
    checklist.isCopiedFromCheckIn ? (mark.clientKey ?? mark.id) : mark.id;
  const copiedFrom = marks.map(photoMarkIdOf).filter((id) => !marks.some((mark) => mark.id === id));
  const photoRows =
    copiedFrom.length === 0
      ? rows
      : [...rows, ...(await photosInUse(tx, operatorId, inArray(files.damageMarkId, copiedFrom)))];
  return marks.map((mark) => {
    const photoMarkId = photoMarkIdOf(mark);
    const photo = photoRows.find((file) => file.damageMarkId === photoMarkId);
    return {
      id: mark.id,
      photoMarkId,
      x: mark.x,
      y: mark.y,
      description: mark.description,
      photo: photo ? photoFor(photoRows, photo.id) : null,
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
        driverId: checklistDriverId,
        photoChecklistId,
        bondCents: rentals.bondCents,
        plannedStart: rentals.plannedStart,
        plannedEnd: rentals.plannedEnd,
        // When the Renter got the car they have now: the handover, or the latest swap.
        handedOverAt: sql<Date | null>`coalesce((
          select max(${possessions.startedAt}) from ${possessions}
          where ${possessions.rentalId} = ${rentals.id} and ${possessions.operatorId} = ${rentals.operatorId}
        ), ${rentals.handedOverAt})`.mapWith(rentals.handedOverAt),
        settingsSnapshot: rentals.settingsSnapshot,
        renterFullName: renters.fullName,
        renterEmail: renters.email,
        renterKind: renters.kind,
        renterTradingName: renters.tradingName,
        renterContactName: renters.contactName,
        driverFullName: driverColumn("full_name"),
        driverEmail: driverColumn("email"),
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
    const rows = await checklistPhotos(tx, operatorId, row.photoChecklistId);
    const photos = listedPhotos(rows);
    const damageMarks = await damageMarkViews(
      tx,
      operatorId,
      {
        inspectionId,
        isCopiedFromCheckIn: inspection.isForDriverChange && inspection.kind === "handover",
      },
      rows,
    );
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
      isForSwap: inspection.isForSwap,
      isForDriverChange: inspection.isForDriverChange,
      rentalId: inspection.rentalId,
      vehicleId: inspection.vehicleId,
      renterId: row.renterId,
      driverId: row.driverId,
      renterFullName: row.renterFullName,
      renterEmail: row.renterEmail,
      renterKind: row.renterKind,
      renterShownName: renterShownName({
        kind: row.renterKind,
        fullName: row.renterFullName,
        preferredName: null,
        tradingName: row.renterTradingName,
      }),
      renterGreetingName: row.renterContactName ?? row.renterFullName,
      driverFullName: row.driverFullName,
      driverEmail: row.driverEmail,
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
          // The rental's own handover and return; a swap's or driver change's pair shows with it.
          eq(inspections.isForSwap, false),
          eq(inspections.isForDriverChange, false),
        ),
      ),
  );
  return {
    inProgressId: rows.find((row) => row.status === "in_progress")?.id ?? null,
    completedAt: rows.find((row) => row.status === "completed")?.completedAt ?? null,
  };
}

/**
 * What a phone may keep of a rental's checklists (review A6-4): the pages of
 * those still under way, and the ids of those that ended (finished or
 * cancelled, here or on another phone), whose copies it should wipe.
 */
export interface ChecklistsOnPhone {
  endedInspectionIds: string[];
  openPagePaths: string[];
}

function checklistPagePaths(
  rentalId: string,
  checklist: { kind: InspectionKind; isForSwap: boolean; isForDriverChange: boolean },
): string[] {
  const { kind } = checklist;
  if (checklist.isForSwap) {
    return [rentalSwapPath(rentalId, "old"), rentalSwapPath(rentalId, "new")];
  }
  if (checklist.isForDriverChange) {
    return [rentalDriverChangePath(rentalId, "check-in"), rentalDriverChangePath(rentalId, "sign")];
  }
  return [kind === "handover" ? rentalHandoverPath(rentalId) : rentalReturnPath(rentalId)];
}

export async function loadChecklistsOnPhone(
  database: AnyDatabase,
  operatorId: string,
  rentalId: string,
): Promise<ChecklistsOnPhone> {
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        id: inspections.id,
        status: inspections.status,
        kind: inspections.kind,
        isForSwap: inspections.isForSwap,
        isForDriverChange: inspections.isForDriverChange,
      })
      .from(inspections)
      .where(and(eq(inspections.operatorId, operatorId), eq(inspections.rentalId, rentalId))),
  );
  const open = rows.filter((row) => row.status === "in_progress");
  return {
    endedInspectionIds: rows.filter((row) => row.status !== "in_progress").map((row) => row.id),
    openPagePaths: open.flatMap((row) => checklistPagePaths(rentalId, row)),
  };
}

/**
 * The handover a return compares with: the latest finished handover of that
 * car under the rental (the rental's own, or the swap that brought the car
 * in); null if it has none.
 */
export async function loadCompletedHandover(
  database: AnyDatabase,
  operatorId: string,
  rental: { rentalId: string; vehicleId: string },
): Promise<HandoverView | null> {
  const [handover] = await withTenant(database, operatorId, (tx) =>
    tx
      .select({ id: inspections.id })
      .from(inspections)
      .where(latestHandoverOf(operatorId, rental))
      .orderBy(desc(inspections.completedAt))
      .limit(1),
  );
  return handover ? loadHandover(database, operatorId, handover.id) : null;
}

/**
 * Who signs for the car on the Operator's phone (rule 15): the Renter for a
 * person; for a business, its named driver (none while still to be named).
 * A typed signature is checked against this name.
 */
export function signerNameOf(
  view: Pick<HandoverView, "renterKind" | "renterFullName" | "driverFullName">,
): string | null {
  return view.renterKind === "organisation" ? view.driverFullName : view.renterFullName;
}

/** The words a business's driver accepts the car with; none for a person's own rental. */
export function businessAcceptanceOf(
  view: Pick<HandoverView, "renterKind" | "renterFullName" | "driverFullName">,
): BusinessAcceptance | undefined {
  return view.renterKind === "organisation" && view.driverFullName
    ? { driverName: view.driverFullName, businessName: view.renterFullName }
    : undefined;
}

/**
 * Who a checklist's emailed copies go to and greet (rule 15): the Renter's
 * email (a business's contact), greeted by name, and for a business's car
 * the driver who signed and the business they have it for, with the driver's
 * own copy to the driver's own email. The view is the one the signature was
 * checked against, so the copy goes to the driver who signed.
 */
export function checklistCopyParties(
  view: Pick<
    HandoverView,
    | "renterKind"
    | "renterFullName"
    | "driverFullName"
    | "driverEmail"
    | "renterEmail"
    | "renterGreetingName"
  >,
): {
  renterEmail: string | null;
  renterName: string;
  forBusiness?: BusinessAcceptance;
  driverCopy?: { email: string | null };
} {
  const forBusiness = businessAcceptanceOf(view);
  return {
    renterEmail: view.renterEmail,
    renterName: view.renterGreetingName,
    ...(forBusiness ? { forBusiness, driverCopy: { email: view.driverEmail } } : {}),
  };
}

/** Who a checklist is with, in words: "Sam Example", or "Acme Rides, driver Sam Lee". */
export function checklistPartyWords(
  view: Pick<HandoverView, "renterKind" | "renterFullName" | "renterShownName" | "driverFullName">,
): string {
  if (view.renterKind !== "organisation") {
    return view.renterFullName;
  }
  return `${view.renterShownName}, ${view.driverFullName ? `driver ${view.driverFullName}` : "driver to be named"}`;
}

/** What a checklist page's signing step needs: who signs, and for a business, for whom. */
export function checklistSigner(view: HandoverView): {
  renterName: string;
  forBusiness?: BusinessAcceptance;
} {
  const forBusiness = businessAcceptanceOf(view);
  return {
    renterName: signerNameOf(view) ?? view.renterFullName,
    ...(forBusiness ? { forBusiness } : {}),
  };
}
