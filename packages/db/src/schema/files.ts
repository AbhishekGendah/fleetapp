import { FILE_PURPOSES, LICENCE_SIDES, STORAGE_AREAS } from "@fleetapp/core";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

import { primaryKeyColumn, timestampColumns } from "./columns";
import { operatorIdColumn } from "./operators";
import { renters } from "./renters";
import { users } from "./users";
import { vehicleCosts, vehiclePurchases, vehicleSales } from "./vehicle-costs";
import { insurancePolicies, vehicleRegistrations } from "./vehicle-paperwork";
import { vehicles } from "./vehicles";

/** The two-column link to an attachment's record, so it can only be the same Operator's. */
function recordLink(
  name: string,
  column: AnyPgColumn,
  operatorId: AnyPgColumn,
  record: { id: AnyPgColumn; operatorId: AnyPgColumn },
) {
  return foreignKey({
    name: `files_${name}_fk`,
    columns: [column, operatorId],
    foreignColumns: [record.id, record.operatorId],
  });
}

export const filePurposeEnum = pgEnum("file_purpose", FILE_PURPOSES);
export const storageAreaEnum = pgEnum("storage_area", STORAGE_AREAS);
export const licenceSideEnum = pgEnum("licence_side", LICENCE_SIDES);

/**
 * One row per stored file (rules 21 to 23). The file itself is in storage;
 * this is the record of whose it is, where it is, and what happened to it.
 * An Operator's logo is its one confirmed, not-deleted `operator_logo` file.
 *
 * No original file name is kept: names often carry people's names, and
 * nothing needs them. A file is never deleted from here, only marked: it
 * moves from pending, to confirmed or refused, to deleted, to purged once
 * the clean-up job has removed it from storage for good (rule 13).
 */
export const files = pgTable(
  "files",
  {
    ...primaryKeyColumn,
    ...operatorIdColumn,

    purpose: filePurposeEnum("purpose").notNull(),
    /** Which bucket: identity documents are kept apart (rule 8). */
    storageArea: storageAreaEnum("storage_area").notNull(),
    /** Its address in the bucket, built by the server under its Operator. */
    objectKey: text("object_key").notNull().unique(),
    contentType: text("content_type").notNull(),
    /** As declared when the upload was allowed, then as actually stored. */
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    uploadedByUserId: uuid("uploaded_by_user_id").references(() => users.id),
    /** The car a photo or document belongs to. */
    vehicleId: uuid("vehicle_id"),
    /** A document's name typed by the Operator, or a photo's given name ("1ABC234 2026-10-30 001"). */
    label: text("label"),
    /** A photo's small copy points at the photo, and goes when it goes. */
    thumbnailOfFileId: uuid("thumbnail_of_file_id"),
    /** An attachment belongs to exactly one of these records. */
    registrationId: uuid("registration_id"),
    policyId: uuid("policy_id"),
    costId: uuid("cost_id"),
    purchaseId: uuid("purchase_id"),
    saleId: uuid("sale_id"),
    /** A licence scan's Renter, and which side of the card it shows. */
    renterId: uuid("renter_id"),
    licenceSide: licenceSideEnum("licence_side"),

    /** The upload arrived and really is the type it claimed. */
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    /** The upload was not what it claimed, or never arrived; removed from storage. */
    refusedAt: timestamp("refused_at", { withTimezone: true }),
    /** Hidden at once; kept in storage for 30 days in case it was a mistake. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    /** Removed from storage for good by the clean-up job. */
    purgedAt: timestamp("purged_at", { withTimezone: true }),

    ...timestampColumns,
  },
  (table) => [
    index("files_operator_idx").on(table.operatorId, table.createdAt),
    unique("files_id_operator_unique").on(table.id, table.operatorId),
    // The two-column links: a file can only point at its own Operator's car or photo.
    foreignKey({
      name: "files_vehicle_fk",
      columns: [table.vehicleId, table.operatorId],
      foreignColumns: [vehicles.id, vehicles.operatorId],
    }),
    foreignKey({
      name: "files_thumbnail_of_fk",
      columns: [table.thumbnailOfFileId, table.operatorId],
      foreignColumns: [table.id, table.operatorId],
    }),
    recordLink("registration", table.registrationId, table.operatorId, vehicleRegistrations),
    recordLink("policy", table.policyId, table.operatorId, insurancePolicies),
    recordLink("cost", table.costId, table.operatorId, vehicleCosts),
    recordLink("purchase", table.purchaseId, table.operatorId, vehiclePurchases),
    recordLink("sale", table.saleId, table.operatorId, vehicleSales),
    recordLink("renter", table.renterId, table.operatorId, renters),
    index("files_vehicle_idx").on(table.operatorId, table.vehicleId, table.purpose),
    // Compared as text: Postgres will not use an enum value in the same
    // migration that adds it.
    check(
      "files_vehicle_purposes",
      sql`(${table.purpose}::text not in ('vehicle_photo', 'vehicle_photo_thumbnail', 'vehicle_document') or ${table.vehicleId} is not null)
        and (${table.purpose}::text <> 'operator_logo' or ${table.vehicleId} is null)
        and (${table.purpose}::text = 'vehicle_photo_thumbnail') = (${table.thumbnailOfFileId} is not null)
        and (${table.purpose}::text in ('vehicle_photo', 'vehicle_document', 'vehicle_attachment', 'vehicle_identity_attachment')) = (${table.label} is not null)`,
    ),
    // An attachment belongs to exactly one record; purchase and sale papers
    // are identity attachments, the rest are not. A fleet policy's
    // attachment has no single car.
    check(
      "files_attachment_links",
      sql`num_nonnulls(${table.registrationId}, ${table.policyId}, ${table.costId}, ${table.purchaseId}, ${table.saleId})
          = (case when ${table.purpose}::text in ('vehicle_attachment', 'vehicle_identity_attachment') then 1 else 0 end)
        and (${table.purpose}::text <> 'vehicle_identity_attachment' or num_nonnulls(${table.purchaseId}, ${table.saleId}) = 1)
        and (${table.purpose}::text <> 'vehicle_attachment' or num_nonnulls(${table.purchaseId}, ${table.saleId}) = 0)
        and (${table.purpose}::text not in ('vehicle_attachment', 'vehicle_identity_attachment') or (${table.policyId} is null) = (${table.vehicleId} is not null))`,
    ),
    // A licence scan names its Renter and side; nothing else does.
    check(
      "files_licence_scan_links",
      sql`(${table.purpose}::text = 'renter_licence_scan') = (${table.renterId} is not null)
        and (${table.renterId} is null) = (${table.licenceSide} is null)
        and (${table.purpose}::text <> 'renter_licence_scan' or ${table.vehicleId} is null)`,
    ),
    // One scan in use per side: a new one marks the old one deleted in the
    // same transaction that confirms it, as for logos.
    uniqueIndex("files_one_licence_scan_per_side")
      .on(table.operatorId, table.renterId, table.licenceSide)
      // Keyed on the Renter link, which only licence scans have (checked
      // above): the new file kind cannot be named in the migration adding it.
      .where(
        sql`${table.renterId} is not null and ${table.confirmedAt} is not null and ${table.deletedAt} is null`,
      ),
    // Photo names ("1ABC234 2026-10-30 001") are numbered per car per day, never reused.
    uniqueIndex("files_one_photo_name_per_car")
      .on(table.operatorId, table.vehicleId, table.label)
      .where(sql`${table.purpose} = 'vehicle_photo'`),
    // An Operator has at most one logo in use: replacing it marks the old one
    // deleted in the same transaction that confirms the new one.
    uniqueIndex("files_one_logo_per_operator")
      .on(table.operatorId)
      .where(
        sql`${table.purpose} = 'operator_logo' and ${table.confirmedAt} is not null and ${table.deletedAt} is null`,
      ),
  ],
);
