import type { FilePurpose } from "@fleetapp/core";
import { DemoDataError, type DemoContext } from "./demo-context";
import { files } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq } from "drizzle-orm";

import type { ActingUser } from "../acting-user";
import type { CarPhotoUploadStart } from "../files/car-files";
import { confirmUpload, incomingKeyFor, type FileDependencies } from "../files/stored-files";

const DEMO_FILE_NOT_KEPT = "A demo file was not kept.";

/** A demo picture as bytes, with the type its content really is. */
export interface DemoPicture {
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png";
}

export function pictureFrom(base64: string): DemoPicture {
  return { bytes: Uint8Array.from(Buffer.from(base64, "base64")), contentType: "image/jpeg" };
}

/** The size to ask for when starting an upload of this picture. */
export function plannedSizeOf(picture: DemoPicture): {
  contentType: string;
  sizeBytes: number;
} {
  return { contentType: picture.contentType, sizeBytes: picture.bytes.length };
}

/**
 * Sends an upload the app has allowed, as the browser would, then confirms
 * it through the same checks as a real one (type from content, rule 22).
 */
export async function sendDemoUpload(
  deps: FileDependencies,
  actor: ActingUser,
  upload: { fileId: string; picture: DemoPicture; purposes: readonly FilePurpose[] },
): Promise<void> {
  const [file] = await withTenant(deps.database, actor.operatorId, (tx) =>
    tx
      .select({ objectKey: files.objectKey, storageArea: files.storageArea })
      .from(files)
      .where(and(eq(files.id, upload.fileId), eq(files.operatorId, actor.operatorId))),
  );
  if (!file) {
    throw new DemoDataError(DEMO_FILE_NOT_KEPT);
  }
  await deps.storage.save(
    file.storageArea,
    incomingKeyFor(file.objectKey),
    upload.picture.bytes,
    upload.picture.contentType,
  );
  const result = await confirmUpload(deps, actor, upload.fileId, upload.purposes);
  if (result !== "confirmed") {
    throw new DemoDataError(`${DEMO_FILE_NOT_KEPT} (${result})`);
  }
}

/** Sends a car photo and its small copy (the same demo picture), once the app has allowed both. */
export async function sendDemoPhoto(
  context: Pick<DemoContext, "deps" | "actor">,
  start: CarPhotoUploadStart,
  picture: DemoPicture,
): Promise<void> {
  if (start.status !== "allowed") {
    throw new DemoDataError(`A demo photo was not allowed: ${start.status}`);
  }
  await sendDemoUpload(context.deps, context.actor, {
    fileId: start.photo.fileId,
    picture,
    purposes: ["vehicle_photo"],
  });
  await sendDemoUpload(context.deps, context.actor, {
    fileId: start.thumbnail.fileId,
    picture,
    purposes: ["vehicle_photo_thumbnail"],
  });
}
