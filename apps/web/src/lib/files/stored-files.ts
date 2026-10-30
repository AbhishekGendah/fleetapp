import {
  buildFileKey,
  checkUpload,
  detectFileType,
  FILE_PURPOSE_RULES,
  FILE_SIGNATURE_LENGTH,
  type FilePurpose,
  type UploadProblem,
} from "@fleetapp/core";
import { recordActivity } from "@fleetapp/db/activity";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, files } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, inArray, isNotNull, isNull, type SQL } from "drizzle-orm";

import type { FileStorage, UploadPermission } from "../storage/file-storage";

export interface FileDependencies {
  database: AnyDatabase;
  storage: FileStorage;
  now: () => Date;
}

/** Who is acting: always from the signed-in User, never from the browser (rule 1). */
export interface FileActor {
  userId: string;
  operatorId: string;
}

export interface UploadRequest {
  purpose: FilePurpose;
  contentType: string;
  sizeBytes: number;
  /**
   * For a car's files: which car, its name, a small copy's photo. Given as a
   * step when it must be worked out in the same transaction as the record,
   * e.g. a photo's next number.
   */
  links?: FileLinks | ((tx: AnyTransaction) => Promise<FileLinks>);
}

export interface FileLinks {
  vehicleId?: string;
  label?: string;
  thumbnailOfFileId?: string;
  registrationId?: string;
  policyId?: string;
  costId?: string;
  purchaseId?: string;
  saleId?: string;
}

export type UploadRequestResult =
  | { status: "allowed"; fileId: string; permission: UploadPermission }
  | { status: "refused"; problem: UploadProblem };

export function logFile(
  tx: AnyTransaction,
  actor: FileActor,
  fileId: string,
  action: "uploaded" | "refused" | "deleted" | "viewed",
  purpose: FilePurpose,
): Promise<void> {
  return recordActivity(tx, {
    operatorId: actor.operatorId,
    actor: { type: "user", id: actor.userId },
    entityType: ACTIVITY_ENTITY_TYPES.file,
    entityId: fileId,
    action: ACTIVITY_ACTIONS[action],
    valuesAfter: { purpose },
  });
}

/**
 * Step one of an upload: checks the type and size against the purpose,
 * records a pending file under the signed-in User's Operator, and hands out
 * a permission to send exactly that file to exactly that address.
 */
export async function requestUpload(
  deps: FileDependencies,
  actor: FileActor,
  request: UploadRequest,
): Promise<UploadRequestResult> {
  const problem = checkUpload(request.purpose, request.contentType, request.sizeBytes);
  if (problem) {
    return { status: "refused", problem };
  }
  const rule = FILE_PURPOSE_RULES[request.purpose];
  const fileId = crypto.randomUUID();
  const objectKey = buildFileKey(actor.operatorId, request.purpose, fileId);

  await withTenant(deps.database, actor.operatorId, async (tx) => {
    const links = typeof request.links === "function" ? await request.links(tx) : request.links;
    await tx.insert(files).values({
      id: fileId,
      operatorId: actor.operatorId,
      purpose: request.purpose,
      storageArea: rule.area,
      objectKey,
      contentType: request.contentType,
      sizeBytes: request.sizeBytes,
      uploadedByUserId: actor.userId,
      ...links,
    });
  });

  const permission = await deps.storage.createUploadPermission({
    area: rule.area,
    key: objectKey,
    contentType: request.contentType,
    maxBytes: rule.maxBytes,
  });
  return { status: "allowed", fileId, permission };
}

export type ConfirmResult = "confirmed" | "not_found" | "not_arrived" | "wrong_type";

/** The pending file, looked up only within the signed-in User's Operator. */
async function findPendingFile(deps: FileDependencies, actor: FileActor, fileId: string) {
  const [file] = await withTenant(deps.database, actor.operatorId, (tx) =>
    tx
      .select()
      .from(files)
      .where(
        and(
          eq(files.id, fileId),
          isNull(files.confirmedAt),
          isNull(files.refusedAt),
          isNull(files.deletedAt),
        ),
      ),
  );
  return file ?? null;
}

/**
 * Step two, once the browser has sent the file: reads its first bytes from
 * storage and checks it really is the type it claimed (rule 22). Anything
 * else is removed from storage and marked refused. A logo replaces the
 * Operator's previous one, which is marked deleted in the same step.
 */
export async function confirmUpload(
  deps: FileDependencies,
  actor: FileActor,
  fileId: string,
): Promise<ConfirmResult> {
  const file = await findPendingFile(deps, actor, fileId);
  if (!file) {
    return "not_found";
  }
  const storedSize = await deps.storage.findStoredSize(file.storageArea, file.objectKey);
  if (storedSize === null) {
    return "not_arrived";
  }
  const firstBytes = await deps.storage.readStart(
    file.storageArea,
    file.objectKey,
    FILE_SIGNATURE_LENGTH,
  );
  const isWhatItClaimed =
    detectFileType(firstBytes) === file.contentType &&
    storedSize <= FILE_PURPOSE_RULES[file.purpose].maxBytes;
  const now = deps.now();

  if (!isWhatItClaimed) {
    await deps.storage.remove(file.storageArea, file.objectKey);
    await withTenant(deps.database, actor.operatorId, async (tx) => {
      await tx.update(files).set({ refusedAt: now }).where(eq(files.id, file.id));
      await logFile(tx, actor, file.id, "refused", file.purpose);
    });
    return "wrong_type";
  }

  await withTenant(deps.database, actor.operatorId, async (tx) => {
    if (file.purpose === "operator_logo") {
      await markLogoDeleted(tx, actor, now);
    }
    await tx
      .update(files)
      .set({ confirmedAt: now, sizeBytes: storedSize })
      .where(eq(files.id, file.id));
    await logFile(tx, actor, file.id, "uploaded", file.purpose);
  });
  return "confirmed";
}

/** The logo in use: confirmed and not deleted. A pending upload is not one yet. */
function logoInUse(operatorId: string) {
  return and(
    eq(files.operatorId, operatorId),
    eq(files.purpose, "operator_logo"),
    isNotNull(files.confirmedAt),
    isNull(files.deletedAt),
  );
}

/** Hides the Operator's current logo at once; storage keeps it 30 days (rule 23). */
async function markLogoDeleted(tx: AnyTransaction, actor: FileActor, now: Date): Promise<boolean> {
  const removed = await tx
    .update(files)
    .set({ deletedAt: now })
    .where(logoInUse(actor.operatorId))
    .returning({ id: files.id });
  for (const logo of removed) {
    await logFile(tx, actor, logo.id, "deleted", "operator_logo");
  }
  return removed.length > 0;
}

export async function removeLogo(deps: FileDependencies, actor: FileActor): Promise<boolean> {
  return withTenant(deps.database, actor.operatorId, (tx) =>
    markLogoDeleted(tx, actor, deps.now()),
  );
}

/** A 5-minute link to the Operator's logo, or null if it has none. */
export async function findLogoViewUrl(
  deps: Pick<FileDependencies, "database" | "storage">,
  operatorId: string,
): Promise<string | null> {
  const [logo] = await withTenant(deps.database, operatorId, (tx) =>
    tx
      .select({ storageArea: files.storageArea, objectKey: files.objectKey })
      .from(files)
      .where(logoInUse(operatorId)),
  );
  if (!logo) {
    return null;
  }
  return deps.storage.createViewUrl(logo.storageArea, logo.objectKey);
}

/**
 * Every file of these kinds belonging to something, removed ones too, so
 * its Log can show their uploads, openings and removals.
 */
export async function listLoggedFileIds(
  database: FileDependencies["database"],
  operatorId: string,
  belongingTo: SQL,
  purposes: readonly FilePurpose[],
): Promise<string[]> {
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({ id: files.id })
      .from(files)
      .where(
        and(eq(files.operatorId, operatorId), belongingTo, inArray(files.purpose, [...purposes])),
      ),
  );
  return rows.map((row) => row.id);
}
