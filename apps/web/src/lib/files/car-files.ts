import {
  downloadName,
  photoName,
  photoNamePrefix,
  todayInTimeZone,
  type FilePurpose,
} from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";
import { files, vehicles } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, count, desc, eq, inArray, isNotNull, isNull, like, or } from "drizzle-orm";

import { findCurrentVehicle } from "../vehicles/current-vehicle";
import {
  listLoggedFileIds,
  logFile,
  requestUpload,
  type FileActor,
  type FileDependencies,
  type UploadRequestResult,
} from "./stored-files";

/** What the browser says it is about to send: checked again once it arrives. */
export interface PlannedFile {
  contentType: string;
  sizeBytes: number;
}

type Refused = Extract<UploadRequestResult, { status: "refused" }>;
type Allowed = Extract<UploadRequestResult, { status: "allowed" }>;

export type CarPhotoUploadStart =
  { status: "allowed"; photo: Allowed; thumbnail: Allowed } | Refused | { status: "not_found" };

export type CarDocumentUploadStart = Allowed | Refused | { status: "not_found" };

async function isCurrentCar(deps: FileDependencies, actor: FileActor, vehicleId: string) {
  return withTenant(deps.database, actor.operatorId, async (tx) =>
    Boolean(await findCurrentVehicle(tx, actor.operatorId, vehicleId)),
  );
}

/**
 * The photo's name: the car's rego, today on the Operator's clock, and the
 * next number that day. The car is locked first, so photos sent at the same
 * moment still get a number each.
 */
async function nextPhotoName(
  tx: AnyTransaction,
  operatorId: string,
  vehicleId: string,
  today: string,
): Promise<string> {
  const [car] = await tx
    .select({ rego: vehicles.rego })
    .from(vehicles)
    .where(and(eq(vehicles.id, vehicleId), eq(vehicles.operatorId, operatorId)))
    .for("update");
  const rego = car?.rego ?? "";
  const [taken] = await tx
    .select({ count: count() })
    .from(files)
    .where(
      and(
        eq(files.operatorId, operatorId),
        eq(files.vehicleId, vehicleId),
        eq(files.purpose, "vehicle_photo"),
        // Regos are capitals and digits only, so nothing in them acts as a wildcard.
        like(files.label, `${photoNamePrefix(rego, today)}%`),
      ),
    );
  return photoName(rego, today, (taken?.count ?? 0) + 1);
}

/**
 * Starts sending a photo and its small copy, both shrunk on the phone. The
 * photo is recorded first, as its small copy points at it, and named
 * "1ABC234 2026-10-30 001". Archived cars take no new files.
 */
export async function startCarPhotoUpload(
  deps: FileDependencies,
  actor: FileActor,
  vehicleId: string,
  planned: { photo: PlannedFile; thumbnail: PlannedFile },
  timeZone: string,
): Promise<CarPhotoUploadStart> {
  if (!(await isCurrentCar(deps, actor, vehicleId))) {
    return { status: "not_found" };
  }
  const today = todayInTimeZone(deps.now(), timeZone);
  const photo = await requestUpload(deps, actor, {
    purpose: "vehicle_photo",
    ...planned.photo,
    links: async (tx) => ({
      vehicleId,
      label: await nextPhotoName(tx, actor.operatorId, vehicleId, today),
    }),
  });
  if (photo.status === "refused") {
    return photo;
  }
  const thumbnail = await requestUpload(deps, actor, {
    purpose: "vehicle_photo_thumbnail",
    ...planned.thumbnail,
    links: { vehicleId, thumbnailOfFileId: photo.fileId },
  });
  return thumbnail.status === "refused" ? thumbnail : { status: "allowed", photo, thumbnail };
}

/** Starts sending a document, with the name the Operator gave it. */
export async function startCarDocumentUpload(
  deps: FileDependencies,
  actor: FileActor,
  vehicleId: string,
  document: PlannedFile & { label: string },
): Promise<CarDocumentUploadStart> {
  if (!(await isCurrentCar(deps, actor, vehicleId))) {
    return { status: "not_found" };
  }
  const { label, ...planned } = document;
  return requestUpload(deps, actor, {
    purpose: "vehicle_document",
    ...planned,
    links: { vehicleId, label },
  });
}

/** A car's file that is in use: arrived, checked, and not removed. */
function carFileInUse(operatorId: string, vehicleId: string, purposes: readonly FilePurpose[]) {
  return and(
    eq(files.operatorId, operatorId),
    eq(files.vehicleId, vehicleId),
    inArray(files.purpose, [...purposes]),
    isNotNull(files.confirmedAt),
    isNull(files.deletedAt),
  );
}

export interface CarPhoto {
  id: string;
  /** "1ABC234 2026-10-30 001". */
  label: string;
  createdAt: Date;
  /** A 5-minute link to the small copy, or null if it did not arrive (the photo is shown instead). */
  thumbnailUrl: string | null;
}

/** A car's photos, newest first, each with a link to its small copy for the grid. */
export async function listCarPhotos(
  deps: Pick<FileDependencies, "database" | "storage">,
  operatorId: string,
  vehicleId: string,
): Promise<CarPhoto[]> {
  const rows = await withTenant(deps.database, operatorId, (tx) =>
    tx
      .select({
        id: files.id,
        purpose: files.purpose,
        label: files.label,
        thumbnailOfFileId: files.thumbnailOfFileId,
        storageArea: files.storageArea,
        objectKey: files.objectKey,
        createdAt: files.createdAt,
      })
      .from(files)
      .where(carFileInUse(operatorId, vehicleId, ["vehicle_photo", "vehicle_photo_thumbnail"]))
      .orderBy(desc(files.createdAt)),
  );
  const photos = rows.filter((row) => row.purpose === "vehicle_photo");
  return Promise.all(
    photos.map(async (photo) => {
      const small = rows.find((row) => row.thumbnailOfFileId === photo.id) ?? photo;
      return {
        id: photo.id,
        label: photo.label ?? "",
        createdAt: photo.createdAt,
        thumbnailUrl: await deps.storage.createViewUrl(small.storageArea, small.objectKey),
      };
    }),
  );
}

export interface CarDocument {
  id: string;
  label: string;
  contentType: string;
  createdAt: Date;
}

/** A car's documents, newest first. */
export async function listCarDocuments(
  database: FileDependencies["database"],
  operatorId: string,
  vehicleId: string,
): Promise<CarDocument[]> {
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        id: files.id,
        label: files.label,
        contentType: files.contentType,
        createdAt: files.createdAt,
      })
      .from(files)
      .where(carFileInUse(operatorId, vehicleId, ["vehicle_document"]))
      .orderBy(desc(files.createdAt)),
  );
  return rows.map((row) => ({ ...row, label: row.label ?? "" }));
}

/**
 * A 5-minute link to one of the car's photos or documents, or null if it is
 * not one of this Operator's, for this car, in use.
 */
export async function findCarFileViewUrl(
  deps: Pick<FileDependencies, "database" | "storage">,
  operatorId: string,
  vehicleId: string,
  fileId: string,
): Promise<string | null> {
  const [file] = await withTenant(deps.database, operatorId, (tx) =>
    tx
      .select({
        storageArea: files.storageArea,
        objectKey: files.objectKey,
        label: files.label,
        contentType: files.contentType,
      })
      .from(files)
      .where(
        and(
          eq(files.id, fileId),
          carFileInUse(operatorId, vehicleId, ["vehicle_photo", "vehicle_document"]),
        ),
      ),
  );
  if (!file) {
    return null;
  }
  return deps.storage.createViewUrl(
    file.storageArea,
    file.objectKey,
    downloadName(file.label ?? "", file.contentType),
  );
}

/**
 * Removes a photo (with its small copy) or a document: hidden at once, kept
 * 30 days in case it was a mistake, then gone for good (rule 23).
 */
export async function removeCarFile(
  deps: FileDependencies,
  actor: FileActor,
  vehicleId: string,
  fileId: string,
): Promise<"removed" | "not_found"> {
  return withTenant(deps.database, actor.operatorId, async (tx) => {
    const removed = await tx
      .update(files)
      .set({ deletedAt: deps.now() })
      .where(
        and(
          // The photo or document itself, and a photo's small copy with it.
          or(
            and(
              eq(files.id, fileId),
              inArray(files.purpose, ["vehicle_photo", "vehicle_document"]),
            ),
            eq(files.thumbnailOfFileId, fileId),
          ),
          carFileInUse(actor.operatorId, vehicleId, [
            "vehicle_photo",
            "vehicle_photo_thumbnail",
            "vehicle_document",
          ]),
        ),
      )
      .returning({ id: files.id, purpose: files.purpose });
    if (!removed.some((file) => file.id === fileId)) {
      return "not_found";
    }
    for (const file of removed) {
      await logFile(tx, actor, file.id, "deleted", file.purpose);
    }
    return "removed";
  });
}

/** Every photo, document and attachment the car has had, removed ones too: for its Log. */
export async function listCarFileIds(
  database: FileDependencies["database"],
  operatorId: string,
  vehicleId: string,
): Promise<string[]> {
  return listLoggedFileIds(database, operatorId, eq(files.vehicleId, vehicleId), [
    "vehicle_photo",
    "vehicle_document",
    "vehicle_attachment",
    "vehicle_identity_attachment",
  ]);
}
