import {
  buildFileKey,
  checkUpload,
  detectFileType,
  downloadName,
  FILE_PURPOSE_RULES,
  FILE_SIGNATURE_LENGTH,
  LICENCE_SIDE_LABELS,
  type FilePurpose,
  type LicenceSide,
  type UploadProblem,
} from "@fleetapp/core";
import { recordActivity } from "@fleetapp/db/activity";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  files,
  renterLinks,
  renterSubmissions,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, inArray, isNotNull, isNull, ne, type SQL } from "drizzle-orm";

import type { FileStorage, UploadPermission } from "../storage/file-storage";

export interface FileDependencies {
  database: AnyDatabase;
  storage: FileStorage;
  now: () => Date;
}

/**
 * Who is acting: the signed-in User, or a Renter's link that has passed its
 * code. Always worked out on the server, never taken from the browser (rule 1).
 */
export type FileActor =
  { operatorId: string; userId: string } | { operatorId: string; linkId: string };

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
  renterId?: string;
  licenceSide?: LicenceSide;
  renterLinkId?: string;
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
    actor:
      "userId" in actor
        ? { type: "user", id: actor.userId }
        : { type: "renter_link", id: actor.linkId },
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
      uploadedByUserId: "userId" in actor ? actor.userId : null,
      ...links,
    });
  });

  const permission = await deps.storage.createUploadPermission({
    area: rule.area,
    key: incomingKeyFor(objectKey),
    contentType: request.contentType,
    maxBytes: rule.maxBytes,
  });
  return { status: "allowed", fileId, permission };
}

export type ConfirmResult = "confirmed" | "not_found" | "not_arrived" | "wrong_type";

/**
 * Where the browser sends a file: never the file's own address. Only bytes
 * that pass the content check are moved to `objectKey`, which no upload
 * permission covers, so they cannot be swapped afterwards (rule 22).
 */
export function incomingKeyFor(objectKey: string): string {
  return `incoming/${objectKey}`;
}

/** Asked for, not yet confirmed, refused or removed. */
function isPending(): SQL | undefined {
  return and(isNull(files.confirmedAt), isNull(files.refusedAt), isNull(files.deletedAt));
}

/** The pending file, looked up only within the actor's Operator. */
async function findPendingFile(deps: FileDependencies, actor: FileActor, fileId: string) {
  const [file] = await withTenant(deps.database, actor.operatorId, (tx) =>
    tx
      .select()
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.operatorId, actor.operatorId), isPending())),
  );
  return file ?? null;
}

/** Only the one who asked to send a file may confirm it: that User, or that Renter link. */
function isUploader(actor: FileActor, file: typeof files.$inferSelect): boolean {
  return "userId" in actor
    ? file.uploadedByUserId === actor.userId
    : file.renterLinkId === actor.linkId;
}

/**
 * A photo sent through a link must not join after the details were sent:
 * the link row is held, as sending holds it, so the two never cross.
 */
async function isLinkAlreadySent(
  tx: AnyTransaction,
  operatorId: string,
  renterLinkId: string,
): Promise<boolean> {
  const [link] = await tx
    .select({ renterId: renterLinks.renterId })
    .from(renterLinks)
    .where(and(eq(renterLinks.id, renterLinkId), eq(renterLinks.operatorId, operatorId)))
    .for("update");
  if (!link) {
    return true;
  }
  const [waiting] = await tx
    .select({ id: renterSubmissions.id })
    .from(renterSubmissions)
    .where(
      and(
        eq(renterSubmissions.operatorId, operatorId),
        eq(renterSubmissions.renterId, link.renterId),
        eq(renterSubmissions.status, "waiting"),
      ),
    );
  return waiting !== undefined;
}

/** Hides what this file replaces (the old logo, scan or link photo), never the file itself. */
async function retirePredecessors(
  tx: AnyTransaction,
  actor: FileActor,
  now: Date,
  file: typeof files.$inferSelect,
): Promise<void> {
  const notThisFile = ne(files.id, file.id);
  if (file.purpose === "operator_logo") {
    await markLogoDeleted(tx, actor, now, notThisFile);
  }
  if (file.renterLinkId && file.licenceSide && !file.submissionId) {
    await markLinkPhotosDeleted(tx, actor, now, file.renterLinkId, file.licenceSide, notThisFile);
  }
  if (file.renterId && file.licenceSide) {
    await markScansDeleted(
      tx,
      actor,
      now,
      and(eq(files.renterId, file.renterId), eq(files.licenceSide, file.licenceSide), notThisFile),
    );
  }
}

/**
 * Marks the file confirmed, holding it so two confirms at once cannot both
 * act, after retiring what it replaces. "not_found" if it was
 * already claimed, or is a link photo arriving after the details were sent.
 */
async function claimConfirmed(
  deps: FileDependencies,
  actor: FileActor,
  file: typeof files.$inferSelect,
  sizeBytes: number,
): Promise<ConfirmResult> {
  const now = deps.now();
  return withTenant(deps.database, actor.operatorId, async (tx): Promise<ConfirmResult> => {
    if (file.purpose === "renter_submitted_scan" && file.renterLinkId) {
      if (await isLinkAlreadySent(tx, actor.operatorId, file.renterLinkId)) {
        return "not_found";
      }
    }
    // Held first: a second confirm of the same file waits here, then finds
    // it no longer pending. Only then is the file it replaces retired (one
    // current logo or scan side at a time), before this one becomes current.
    const [claimed] = await tx
      .select({ id: files.id })
      .from(files)
      .where(and(eq(files.id, file.id), eq(files.operatorId, actor.operatorId), isPending()))
      .for("update");
    if (!claimed) {
      return "not_found";
    }
    await retirePredecessors(tx, actor, now, file);
    await tx
      .update(files)
      .set({ confirmedAt: now, sizeBytes })
      .where(and(eq(files.id, file.id), eq(files.operatorId, actor.operatorId)));
    await logFile(tx, actor, file.id, "uploaded", file.purpose);
    return "confirmed";
  });
}

/** Removes a file that is not what it claimed, and marks it refused. */
async function refuseUpload(
  deps: FileDependencies,
  actor: FileActor,
  file: typeof files.$inferSelect,
): Promise<void> {
  await deps.storage.remove(file.storageArea, incomingKeyFor(file.objectKey));
  await withTenant(deps.database, actor.operatorId, async (tx) => {
    const [refused] = await tx
      .update(files)
      .set({ refusedAt: deps.now() })
      .where(and(eq(files.id, file.id), eq(files.operatorId, actor.operatorId), isPending()))
      .returning({ id: files.id });
    if (refused) {
      await logFile(tx, actor, file.id, "refused", file.purpose);
    }
  });
}

/**
 * Step two, once the browser has sent the file. Only the one who asked may
 * confirm it, and only as the kind the caller expects. Reads the first bytes
 * of exactly what arrived and checks it really is the type it claimed (rule
 * 22); only those bytes are then moved to the file's own address. Anything
 * else is removed and marked refused. A logo replaces the Operator's
 * previous one, a licence scan the Renter's previous scan of that side, and a
 * link photo that link's previous photo of that side.
 */
export async function confirmUpload(
  deps: FileDependencies,
  actor: FileActor,
  fileId: string,
  expectedPurposes: readonly FilePurpose[],
): Promise<ConfirmResult> {
  const file = await findPendingFile(deps, actor, fileId);
  if (!file || !expectedPurposes.includes(file.purpose) || !isUploader(actor, file)) {
    return "not_found";
  }
  const incomingKey = incomingKeyFor(file.objectKey);
  const stored = await deps.storage.inspect(file.storageArea, incomingKey);
  if (!stored) {
    return "not_arrived";
  }
  const firstBytes = await deps.storage.readStart(
    file.storageArea,
    incomingKey,
    FILE_SIGNATURE_LENGTH,
    stored.version,
  );
  const isWhatItClaimed =
    detectFileType(firstBytes) === file.contentType &&
    stored.sizeBytes <= FILE_PURPOSE_RULES[file.purpose].maxBytes;
  if (!isWhatItClaimed) {
    await refuseUpload(deps, actor, file);
    return "wrong_type";
  }
  if (
    !(await deps.storage.promote(file.storageArea, incomingKey, file.objectKey, stored.version))
  ) {
    // Changed after it was checked: the browser can send it again.
    return "not_arrived";
  }
  return claimConfirmed(deps, actor, file, stored.sizeBytes);
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
async function markLogoDeleted(
  tx: AnyTransaction,
  actor: FileActor,
  now: Date,
  except?: SQL,
): Promise<boolean> {
  const removed = await tx
    .update(files)
    .set({ deletedAt: now })
    .where(and(logoInUse(actor.operatorId), except))
    .returning({ id: files.id });
  for (const logo of removed) {
    await logFile(tx, actor, logo.id, "deleted", "operator_logo");
  }
  return removed.length > 0;
}

/** A licence scan that is in use: confirmed and not deleted. */
export function licenceScanInUse(operatorId: string): SQL | undefined {
  return and(
    eq(files.operatorId, operatorId),
    eq(files.purpose, "renter_licence_scan"),
    isNotNull(files.confirmedAt),
    isNull(files.deletedAt),
  );
}

/**
 * A 5-minute link to one licence image (a scan, or a photo a Renter sent),
 * or null if `which` does not match it. Every opening is logged with who
 * looked (rule 8), so listing images never counts as looking.
 */
export async function openLicenceImage(
  deps: FileDependencies,
  actor: FileActor,
  image: {
    fileId: string;
    purpose: "renter_licence_scan" | "renter_submitted_scan";
    which: SQL | undefined;
    /** What the download is called before its side, e.g. "Licence" for "Licence front". */
    namePrefix: string;
  },
): Promise<string | null> {
  const found = await withTenant(deps.database, actor.operatorId, async (tx) => {
    const [row] = await tx
      .select({
        storageArea: files.storageArea,
        objectKey: files.objectKey,
        contentType: files.contentType,
        side: files.licenceSide,
      })
      .from(files)
      .where(
        and(
          eq(files.operatorId, actor.operatorId),
          eq(files.id, image.fileId),
          eq(files.purpose, image.purpose),
          image.which,
        ),
      );
    if (row) {
      await logFile(tx, actor, image.fileId, "viewed", image.purpose);
    }
    return row;
  });
  if (!found?.side) {
    return null;
  }
  return deps.storage.createViewUrl(
    found.storageArea,
    found.objectKey,
    downloadName(
      `${image.namePrefix} ${LICENCE_SIDE_LABELS[found.side].toLowerCase()}`,
      found.contentType,
    ),
  );
}

/** Why the nightly clean-up binned a file, for its log line (and the Log's wording). */
export const SYSTEM_BIN_REASONS = {
  keptTheSetTime: "kept_the_set_time",
  linkEndedOver30Days: "link_ended_over_30_days",
} as const;
export type SystemBinReason = (typeof SYSTEM_BIN_REASONS)[keyof typeof SYSTEM_BIN_REASONS];

/**
 * Bins the Operator's matching files as the nightly clean-up (no User, rule
 * 3): hidden at once, gone for good 30 days later (rule 23). Each is logged
 * by System with its purpose and the reason.
 */
export async function binFilesAsSystem(
  tx: AnyTransaction,
  operatorId: string,
  now: Date,
  purpose: FilePurpose,
  which: SQL,
  reason: SystemBinReason,
  /** More to keep with the reason, e.g. how many months the setting was then. */
  details: Readonly<Record<string, string | number>> = {},
): Promise<number> {
  const binned = await tx
    .update(files)
    .set({ deletedAt: now })
    .where(
      and(
        eq(files.operatorId, operatorId),
        eq(files.purpose, purpose),
        isNull(files.deletedAt),
        which,
      ),
    )
    .returning({ id: files.id });
  for (const file of binned) {
    await recordActivity(tx, {
      operatorId,
      actor: { type: "system", id: null },
      entityType: ACTIVITY_ENTITY_TYPES.file,
      entityId: file.id,
      action: ACTIVITY_ACTIONS.deleted,
      valuesAfter: { ...details, purpose, reason },
    });
  }
  return binned.length;
}

/** Hides the matching scans at once; storage keeps them 30 days (rule 23). */
export async function markScansDeleted(
  tx: AnyTransaction,
  actor: FileActor,
  now: Date,
  which: SQL | undefined,
): Promise<number> {
  const removed = await tx
    .update(files)
    .set({ deletedAt: now })
    .where(and(licenceScanInUse(actor.operatorId), which))
    .returning({ id: files.id });
  for (const scan of removed) {
    await logFile(tx, actor, scan.id, "deleted", "renter_licence_scan");
  }
  return removed.length;
}

/** A Renter's earlier unsent photo of this side, replaced by a new one (kept 30 days, rule 23). */
async function markLinkPhotosDeleted(
  tx: AnyTransaction,
  actor: FileActor,
  now: Date,
  renterLinkId: string,
  side: LicenceSide,
  except?: SQL,
): Promise<void> {
  const removed = await tx
    .update(files)
    .set({ deletedAt: now })
    .where(
      and(
        eq(files.operatorId, actor.operatorId),
        eq(files.renterLinkId, renterLinkId),
        eq(files.purpose, "renter_submitted_scan"),
        eq(files.licenceSide, side),
        isNull(files.submissionId),
        isNotNull(files.confirmedAt),
        isNull(files.deletedAt),
        except,
      ),
    )
    .returning({ id: files.id });
  for (const photo of removed) {
    await logFile(tx, actor, photo.id, "deleted", "renter_submitted_scan");
  }
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
