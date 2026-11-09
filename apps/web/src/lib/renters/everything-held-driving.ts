import {
  DAMAGE_STATUS_LABELS,
  formatCalendarDate,
  formatDateTimeInTimeZone,
  ISSUED_DOCUMENT_NAMES,
  renterShownName,
  type ExportCell,
} from "@fleetapp/core";
import type { WorkbookSheet } from "@fleetapp/core/spreadsheet";
import type { AnyTransaction } from "@fleetapp/db/client";
import {
  carSwaps,
  damageRecords,
  files,
  issuedDocuments,
  possessions,
  renters,
  vehicles,
} from "@fleetapp/db/schema";
import { aliasedTable, and, asc, eq, inArray, isNotNull, ne, or, sql, type SQL } from "drizzle-orm";

import {
  HELD_DOCUMENT_COLUMNS,
  heldDocumentFileName,
  type HeldDocument,
} from "./everything-held-records";
import type { DrivesFor } from "./organisation-driver-queries";

/**
 * What "everything we hold" adds for a person who drives, or drove, a
 * business's cars (plan "How each flow changes"): each time they had one of
 * its cars (the possession records, rule 15), the reports and swap forms
 * they signed then, damage found when they brought it back, and the
 * businesses they drive for. Never the business's money: that is the
 * business's own. Read in the Operator's tenant context (rule 1).
 */

const business = aliasedTable(renters, "business");

/** Inside `ids`, or nothing at all when there are none (Postgres refuses an empty list). */
function inIds(column: Parameters<typeof inArray>[0], ids: readonly string[]): SQL {
  return ids.length > 0 ? inArray(column, [...ids]) : sql`false`;
}

async function selectDrivingRecords(tx: AnyTransaction, operatorId: string, driverId: string) {
  const driven = await tx
    .select({
      id: possessions.id,
      rentalId: possessions.rentalId,
      rego: vehicles.rego,
      kind: business.kind,
      fullName: business.fullName,
      tradingName: business.tradingName,
      startedAt: possessions.startedAt,
      endedAt: possessions.endedAt,
      handoverInspectionId: possessions.handoverInspectionId,
      returnInspectionId: possessions.returnInspectionId,
    })
    .from(possessions)
    .innerJoin(
      vehicles,
      and(eq(vehicles.id, possessions.vehicleId), eq(vehicles.operatorId, possessions.operatorId)),
    )
    .innerJoin(
      business,
      and(eq(business.id, possessions.renterId), eq(business.operatorId, possessions.operatorId)),
    )
    .where(
      and(
        eq(possessions.operatorId, operatorId),
        eq(possessions.driverId, driverId),
        // Their own rentals are already in the download as theirs.
        ne(possessions.renterId, driverId),
      ),
    )
    .orderBy(asc(possessions.startedAt));
  const returnIds = driven.flatMap((one) =>
    one.returnInspectionId ? [one.returnInspectionId] : [],
  );
  const inspectionIds = [...driven.map((one) => one.handoverInspectionId), ...returnIds];
  const swapDocumentIds = tx
    .select({ id: carSwaps.documentId })
    .from(carSwaps)
    .where(
      and(
        eq(carSwaps.operatorId, operatorId),
        isNotNull(carSwaps.documentId),
        or(
          inIds(carSwaps.returnInspectionId, inspectionIds),
          inIds(carSwaps.handoverInspectionId, inspectionIds),
        ),
      ),
    );
  const [documents, damage] = await Promise.all([
    tx
      .select(HELD_DOCUMENT_COLUMNS)
      .from(issuedDocuments)
      .innerJoin(files, eq(files.id, issuedDocuments.fileId))
      .where(
        and(
          eq(issuedDocuments.operatorId, operatorId),
          or(
            inIds(issuedDocuments.inspectionId, inspectionIds),
            inArray(issuedDocuments.id, swapDocumentIds),
          ),
        ),
      )
      .orderBy(asc(issuedDocuments.issuedAt)),
    tx
      .select({
        id: damageRecords.id,
        rentalId: damageRecords.rentalId,
        foundOn: damageRecords.foundOn,
        description: damageRecords.description,
        status: damageRecords.status,
      })
      .from(damageRecords)
      .where(
        and(
          eq(damageRecords.operatorId, operatorId),
          inIds(damageRecords.returnInspectionId, returnIds),
        ),
      )
      .orderBy(asc(damageRecords.foundOn)),
  ]);
  return { driven, documents: documents as HeldDocument[], damage };
}

export type DrivingRecords = Awaited<ReturnType<typeof selectDrivingRecords>>;

export function loadDrivingRecords(
  tx: AnyTransaction,
  operatorId: string,
  driverId: string,
): Promise<DrivingRecords> {
  return selectDrivingRecords(tx, operatorId, driverId);
}

function nameOf(row: {
  kind: "person" | "organisation";
  fullName: string;
  tradingName: string | null;
}) {
  return renterShownName({ ...row, preferredName: null });
}

/** The driving sheets of "everything we hold", after the Renter's own. */
export function drivingSheets(
  records: DrivingRecords,
  drivesFor: readonly DrivesFor[],
  timeZone: string,
): WorkbookSheet[] {
  const when = (moment: Date | null): ExportCell =>
    moment ? formatDateTimeInTimeZone(moment, timeZone) : null;
  const carOf = new Map(records.driven.map((one) => [one.rentalId, one.rego]));
  return [
    {
      name: "Drives for",
      table: [
        ["Business", "From", "To"],
        ...drivesFor.map((link) => [link.name, when(link.addedAt), when(link.removedAt)]),
      ],
    },
    {
      name: "Cars driven",
      table: [
        ["Car", "For", "From", "To"],
        ...records.driven.map((one) => [
          one.rego,
          nameOf(one),
          when(one.startedAt),
          when(one.endedAt),
        ]),
      ],
    },
    {
      name: "Damage while driving",
      table: [
        ["Car", "Found", "Description", "Status"],
        ...records.damage.map((record) => [
          record.rentalId ? (carOf.get(record.rentalId) ?? null) : null,
          formatCalendarDate(record.foundOn),
          record.description,
          DAMAGE_STATUS_LABELS[record.status],
        ]),
      ],
    },
    {
      name: "Reports signed driving",
      table: [
        ["Document", "Version", "Car", "Issued", "File in this download"],
        ...records.documents.map((document) => [
          ISSUED_DOCUMENT_NAMES[document.kind],
          document.version,
          document.rentalId ? (carOf.get(document.rentalId) ?? null) : null,
          when(document.issuedAt),
          heldDocumentFileName(document),
        ]),
      ],
    },
  ];
}
