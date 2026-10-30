import { downloadName, type FilePurpose } from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";
import {
  files,
  insurancePolicies,
  vehicleCosts,
  vehiclePurchases,
  vehicleRegistrations,
  vehicleSales,
  vehicles,
} from "@fleetapp/db/schema";
import { qualified } from "@fleetapp/db/qualified";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, count, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { findCurrentVehicle } from "../vehicles/current-vehicle";
import type { PlannedFile } from "./car-files";
import {
  listLoggedFileIds,
  logFile,
  requestUpload,
  type FileActor,
  type FileDependencies,
  type UploadRequestResult,
} from "./stored-files";

/** The records a file can be attached to. */
export const ATTACHMENT_KINDS = ["registration", "policy", "cost", "purchase", "sale"] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export interface AttachmentTarget {
  kind: AttachmentKind;
  id: string;
}

const ATTACHMENT_PURPOSES: readonly FilePurpose[] = [
  "vehicle_attachment",
  "vehicle_identity_attachment",
];

/** Purchase and sale papers show the other person's licence and birth date: identity storage (rule 8). */
function purposeFor(kind: AttachmentKind): FilePurpose {
  return kind === "purchase" || kind === "sale"
    ? "vehicle_identity_attachment"
    : "vehicle_attachment";
}

const LINK_COLUMNS = {
  registration: files.registrationId,
  policy: files.policyId,
  cost: files.costId,
  purchase: files.purchaseId,
  sale: files.saleId,
} as const;

/** What a new attachment is linked to and named after: its record, and that record's car. */
interface AttachmentParent {
  vehicleId: string | null;
  /** "1ABC234 rego 2027-10-29": the attachment's name, before its number. */
  nameBase: string;
}

/**
 * The Operator's record, locked so two attachments sent together are still
 * numbered one after the other. Null if it is not theirs, or is on an
 * archived car (read-only).
 */
async function lockParent(
  tx: AnyTransaction,
  operatorId: string,
  target: AttachmentTarget,
): Promise<AttachmentParent | null> {
  const { kind, id } = target;
  if (kind === "policy") {
    const [policy] = await tx
      .select({ insurer: insurancePolicies.insurer, policyNumber: insurancePolicies.policyNumber })
      .from(insurancePolicies)
      .where(
        and(
          eq(insurancePolicies.id, id),
          eq(insurancePolicies.operatorId, operatorId),
          isNull(insurancePolicies.archivedAt),
        ),
      )
      .for("update");
    return policy
      ? { vehicleId: null, nameBase: `${policy.insurer} ${policy.policyNumber}` }
      : null;
  }
  const parent = await lockCarRecord(tx, operatorId, kind, id);
  if (!parent || !(await findCurrentVehicle(tx, operatorId, parent.vehicleId))) {
    return null;
  }
  return { vehicleId: parent.vehicleId, nameBase: `${parent.rego} ${parent.describedAs}` };
}

/** Each car record's table, and what it is called in an attachment's name. */
const CAR_RECORDS = {
  registration: {
    table: vehicleRegistrations,
    describedAs: sql`'rego ' || coalesce(${qualified(vehicleRegistrations.expiresOn)}::text, 'direct debit')`,
  },
  cost: { table: vehicleCosts, describedAs: sql`${qualified(vehicleCosts.description)}` },
  purchase: { table: vehiclePurchases, describedAs: sql`'purchase'` },
  sale: { table: vehicleSales, describedAs: sql`'sale'` },
} as const;

const lockedRecordSchema = z.object({
  rows: z.array(z.object({ vehicle_id: z.uuid(), rego: z.string(), described_as: z.string() })),
});

async function lockCarRecord(
  tx: AnyTransaction,
  operatorId: string,
  kind: Exclude<AttachmentKind, "policy">,
  recordId: string,
): Promise<{ vehicleId: string; rego: string; describedAs: string } | null> {
  const { table, describedAs } = CAR_RECORDS[kind];
  const result = await tx.execute(sql`
    select ${qualified(table.vehicleId)} as vehicle_id, ${qualified(vehicles.rego)} as rego, ${describedAs} as described_as
    from ${table} join ${vehicles} on ${qualified(vehicles.id)} = ${qualified(table.vehicleId)}
    where ${qualified(table.id)} = ${recordId} and ${qualified(table.operatorId)} = ${operatorId}
    for update of ${table}
  `);
  const [row] = lockedRecordSchema.parse(result).rows;
  return row ? { vehicleId: row.vehicle_id, rego: row.rego, describedAs: row.described_as } : null;
}

export type AttachmentUploadStart =
  | Extract<UploadRequestResult, { status: "allowed" }>
  | Extract<UploadRequestResult, { status: "refused" }>
  | { status: "not_found" };

class ParentNotFoundError extends Error {
  constructor() {
    super("The record to attach to is not the Operator's, or its car is archived.");
    this.name = "ParentNotFoundError";
  }
}

/**
 * Starts attaching a file to a record. It is named after the record and
 * numbered ("1ABC234 rego 2027-10-29 2"); purchase and sale papers go in the
 * identity storage.
 */
export async function startAttachmentUpload(
  deps: FileDependencies,
  actor: FileActor,
  target: AttachmentTarget,
  planned: PlannedFile,
): Promise<AttachmentUploadStart> {
  return requestUpload(deps, actor, {
    purpose: purposeFor(target.kind),
    ...planned,
    links: async (tx) => {
      const parent = await lockParent(tx, actor.operatorId, target);
      if (!parent) {
        // Undoes the transaction, so nothing is recorded.
        throw new ParentNotFoundError();
      }
      const [attached] = await tx
        .select({ count: count() })
        .from(files)
        .where(
          and(eq(files.operatorId, actor.operatorId), eq(LINK_COLUMNS[target.kind], target.id)),
        );
      return {
        vehicleId: parent.vehicleId ?? undefined,
        label: `${parent.nameBase} ${(attached?.count ?? 0) + 1}`,
        [`${target.kind}Id`]: target.id,
      };
    },
  }).catch((error: unknown) => {
    if (error instanceof ParentNotFoundError) {
      return { status: "not_found" as const };
    }
    throw error;
  });
}

export interface Attachment {
  id: string;
  label: string;
  contentType: string;
  target: AttachmentTarget;
}

function targetOf(row: Record<`${AttachmentKind}Id`, string | null>): AttachmentTarget | null {
  const kind = ATTACHMENT_KINDS.find((each) => row[`${each}Id`] !== null);
  return kind ? { kind, id: row[`${kind}Id`]! } : null;
}

/** A record's attachments in use: arrived, checked and not removed. */
function attachmentInUse(operatorId: string) {
  return and(
    eq(files.operatorId, operatorId),
    inArray(files.purpose, [...ATTACHMENT_PURPOSES]),
    isNotNull(files.confirmedAt),
    isNull(files.deletedAt),
  );
}

/** The attachments on a car's records and on the given policies, oldest first. */
export async function listAttachments(
  database: FileDependencies["database"],
  operatorId: string,
  belongingTo: { vehicleId?: string; policyIds?: readonly string[] },
): Promise<Attachment[]> {
  const owners = [
    belongingTo.vehicleId ? eq(files.vehicleId, belongingTo.vehicleId) : undefined,
    belongingTo.policyIds?.length ? inArray(files.policyId, [...belongingTo.policyIds]) : undefined,
  ].filter((condition) => condition !== undefined);
  if (owners.length === 0) {
    return [];
  }
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        id: files.id,
        label: files.label,
        contentType: files.contentType,
        registrationId: files.registrationId,
        policyId: files.policyId,
        costId: files.costId,
        purchaseId: files.purchaseId,
        saleId: files.saleId,
      })
      .from(files)
      .where(and(attachmentInUse(operatorId), or(...owners)))
      .orderBy(files.createdAt),
  );
  return rows.flatMap((row) => {
    const target = targetOf(row);
    return target
      ? [{ id: row.id, label: row.label ?? "", contentType: row.contentType, target }]
      : [];
  });
}

/**
 * A 5-minute link to an attachment, or null if it is not one of this
 * Operator's in use. Opening purchase or sale papers is written to the log
 * every time, with who opened them (rule 8).
 */
export async function openAttachment(
  deps: FileDependencies,
  actor: FileActor,
  fileId: string,
): Promise<string | null> {
  const file = await withTenant(deps.database, actor.operatorId, async (tx) => {
    const [found] = await tx
      .select({
        purpose: files.purpose,
        storageArea: files.storageArea,
        objectKey: files.objectKey,
        label: files.label,
        contentType: files.contentType,
      })
      .from(files)
      .where(and(eq(files.id, fileId), attachmentInUse(actor.operatorId)));
    if (found?.storageArea === "identity") {
      await logFile(tx, actor, fileId, "viewed", found.purpose);
    }
    return found;
  });
  if (!file) {
    return null;
  }
  return deps.storage.createViewUrl(
    file.storageArea,
    file.objectKey,
    downloadName(file.label ?? "", file.contentType),
  );
}

/** Takes an attachment off its record: hidden at once, kept 30 days, then gone (rule 23). */
export async function removeAttachment(
  deps: FileDependencies,
  actor: FileActor,
  fileId: string,
): Promise<"removed" | "not_found"> {
  return withTenant(deps.database, actor.operatorId, async (tx) => {
    const [removed] = await tx
      .update(files)
      .set({ deletedAt: deps.now() })
      .where(and(eq(files.id, fileId), attachmentInUse(actor.operatorId)))
      .returning({ id: files.id, purpose: files.purpose });
    if (!removed) {
      return "not_found";
    }
    await logFile(tx, actor, removed.id, "deleted", removed.purpose);
    return "removed";
  });
}

/** Every file ever attached to a policy, removed ones too: for its Log. */
export async function listPolicyFileIds(
  database: FileDependencies["database"],
  operatorId: string,
  policyId: string,
): Promise<string[]> {
  return listLoggedFileIds(database, operatorId, eq(files.policyId, policyId), ATTACHMENT_PURPOSES);
}
