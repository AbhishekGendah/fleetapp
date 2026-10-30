import type { FilePurpose } from "@fleetapp/core";
import { files } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";

import { findCurrentVehicle } from "../vehicles/current-vehicle";
import {
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
 * Starts sending a photo and its small copy, both shrunk on the phone. The
 * photo is recorded first, as its small copy points at it. Archived cars take
 * no new files.
 */
export async function startCarPhotoUpload(
  deps: FileDependencies,
  actor: FileActor,
  vehicleId: string,
  planned: { photo: PlannedFile; thumbnail: PlannedFile },
): Promise<CarPhotoUploadStart> {
  if (!(await isCurrentCar(deps, actor, vehicleId))) {
    return { status: "not_found" };
  }
  const photo = await requestUpload(deps, actor, {
    purpose: "vehicle_photo",
    ...planned.photo,
    links: { vehicleId },
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
      .select({ storageArea: files.storageArea, objectKey: files.objectKey })
      .from(files)
      .where(
        and(
          eq(files.id, fileId),
          carFileInUse(operatorId, vehicleId, ["vehicle_photo", "vehicle_document"]),
        ),
      ),
  );
  return file ? deps.storage.createViewUrl(file.storageArea, file.objectKey) : null;
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

/** Every photo and document the car has had, removed ones too: for its Log. */
export async function listCarFileIds(
  database: FileDependencies["database"],
  operatorId: string,
  vehicleId: string,
): Promise<string[]> {
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({ id: files.id })
      .from(files)
      .where(
        and(
          eq(files.operatorId, operatorId),
          eq(files.vehicleId, vehicleId),
          inArray(files.purpose, ["vehicle_photo", "vehicle_document"]),
        ),
      ),
  );
  return rows.map((row) => row.id);
}
