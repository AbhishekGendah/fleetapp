import {
  countryName,
  formatAbn,
  formatCalendarDate,
  formatDateTimeInTimeZone,
  LICENCE_CLASS_LABELS,
  LICENCE_SIDE_LABELS,
  LICENCE_TYPE_LABELS,
  RENTER_KIND_LABELS,
  RENTER_STATUS_LABELS,
  renterDisplayName,
  type ExportCell,
  type StorageArea,
} from "@fleetapp/core";
import type { WorkbookSheet } from "@fleetapp/core/spreadsheet";
import { describeActivity } from "@fleetapp/db/activity";
import type { AnyDatabase } from "@fleetapp/db/client";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { BRAND } from "@fleetapp/ui/brand";

import { recordUserChange, type ActingUser } from "../acting-user";
import { listRenterLinkIds } from "../renter-links/details-links";
import { detailTexts } from "../renter-links/review-rows";
import { listSubmissionsHeld, type SubmissionHeld } from "../renter-links/reviews";
import { loadRecordHistory, type HistoryEntry } from "../record-history";
import {
  heldDocumentFileName,
  heldRecordSheets,
  loadHeldRecords,
  THE_BUSINESS,
} from "./everything-held-records";
import { listAllLicenceScans, listRenterFileIds, type LicenceScanRecord } from "./licence-scans";
import { listNoteIds, listNotes } from "./notes";
import { loadDrivingRecords, drivingSheets } from "./everything-held-driving";
import {
  listBusinessDrivers,
  listDriverLinkIds,
  listDrivesFor,
  type BusinessDriver,
} from "./organisation-driver-queries";
import {
  BUSINESS_RENTER_FIELD_LABELS,
  businessRenterFieldLabel,
  RENTER_FIELD_LABELS,
  renterFieldLabel,
} from "./renter-labels";
import { loadRenter, type RenterDetail } from "./renter-queries";

const NOT_GIVEN = "Not given";

/** Text as a cell; an Excel text cell never runs as a formula. */
function text(value: string | null | undefined): ExportCell {
  return value || NOT_GIVEN;
}

function fieldRows(lines: readonly [string, string | null][]): ExportCell[][] {
  return [["Detail", "On file"], ...lines.map(([label, value]) => [label, text(value)])];
}

/** Either kind's standing: Do not rent and why, and when added and archived. */
function standingLines(
  renter: RenterDetail,
  labels: Readonly<Record<"status" | "doNotRentReason", string>>,
  timeZone: string,
): [string, string | null][] {
  return [
    [labels.status, RENTER_STATUS_LABELS[renter.status]],
    [labels.doNotRentReason, renter.doNotRentReason],
    ["Added", formatDateTimeInTimeZone(renter.createdAt, timeZone)],
    ["Archived", renter.archivedAt && formatDateTimeInTimeZone(renter.archivedAt, timeZone)],
  ];
}

function detailsSheet(renter: RenterDetail, timeZone: string): WorkbookSheet {
  const labels = RENTER_FIELD_LABELS;
  return {
    name: "Details",
    table: fieldRows([
      [labels.fullName, renter.fullName],
      [labels.preferredName, renter.preferredName],
      [labels.phone, renter.phone],
      [labels.email, renter.email],
      [labels.dateOfBirth, renter.dateOfBirth && formatCalendarDate(renter.dateOfBirth)],
      [labels.residentialAddress, renter.residentialAddress],
      [labels.postalAddress, renter.postalAddress ?? "Same as home"],
      [labels.emergencyContactName, renter.emergencyContactName],
      [labels.emergencyContactPhone, renter.emergencyContactPhone],
      [labels.emergencyContactRelationship, renter.emergencyContactRelationship],
      [labels.abn, renter.abn && formatAbn(renter.abn)],
      ...standingLines(renter, labels, timeZone),
    ]),
  };
}

/** A business's own details: its contact's are personal information too. */
function businessDetailsSheet(renter: RenterDetail, timeZone: string): WorkbookSheet {
  const labels = BUSINESS_RENTER_FIELD_LABELS;
  return {
    name: "Details",
    table: fieldRows([
      ["Kind", RENTER_KIND_LABELS.organisation],
      [labels.fullName, renter.fullName],
      [labels.tradingName, renter.tradingName],
      [labels.abn, renter.abn && formatAbn(renter.abn)],
      [labels.contactName, renter.contactName],
      [labels.phone, renter.phone],
      [labels.email, renter.email],
      [labels.businessAddress, renter.businessAddress],
      [labels.postalAddress, renter.postalAddress ?? "Same as the business address"],
      ...standingLines(renter, labels, timeZone),
    ]),
  };
}

/** A business's drivers, by name and when: never their licence, birthday or address. */
function driversSheet(drivers: readonly BusinessDriver[], timeZone: string): WorkbookSheet {
  return {
    name: "Drivers",
    table: [
      ["Driver", "Added", "Removed"],
      ...drivers.map((driver) => [
        text(renterDisplayName(driver.fullName, driver.preferredName)),
        formatDateTimeInTimeZone(driver.addedAt, timeZone),
        driver.removedAt ? formatDateTimeInTimeZone(driver.removedAt, timeZone) : null,
      ]),
    ],
  };
}

function licenceSheet(renter: RenterDetail): WorkbookSheet {
  const labels = RENTER_FIELD_LABELS;
  return {
    name: "Licence",
    table: fieldRows([
      [labels.licenceIssuedIn, renter.licenceIssuedIn],
      [labels.licenceCountry, renter.licenceCountry && countryName(renter.licenceCountry)],
      [labels.licenceNumber, renter.licenceNumber],
      [labels.licenceClass, renter.licenceClass && LICENCE_CLASS_LABELS[renter.licenceClass]],
      [labels.licenceType, renter.licenceType && LICENCE_TYPE_LABELS[renter.licenceType]],
      [
        labels.licenceExpiresOn,
        renter.licenceExpiresOn && formatCalendarDate(renter.licenceExpiresOn),
      ],
    ]),
  };
}

/** "Phone, Email": the details a change altered, never their values (they are not kept). */
function changedFields(entry: HistoryEntry, fieldLabel: (field: string) => string): string {
  const fields = Object.keys(entry.valuesBefore ?? {});
  return fields.map(fieldLabel).join(", ");
}

/** Who did it, as the Renter sees it: staff are "the business", never named (review A7-8). */
const ACTOR_LABELS: Readonly<Record<HistoryEntry["actorType"], string>> = {
  user: THE_BUSINESS,
  admin: `${BRAND.productName} support`,
  system: "Automatically",
  renter_link: "You, through a link",
};

function logSheet(
  entries: readonly HistoryEntry[],
  timeZone: string,
  fieldLabel: (field: string) => string,
): WorkbookSheet {
  return {
    name: "Log",
    table: [
      ["When", "Who", "What", "Details changed"],
      ...entries.map((entry) => [
        formatDateTimeInTimeZone(entry.occurredAt, timeZone),
        ACTOR_LABELS[entry.actorType],
        describeActivity(entry.entityType, entry.action, entry.valuesAfter),
        text(changedFields(entry, fieldLabel) || null),
      ]),
    ],
  };
}

const SUBMISSION_STATUS_LABELS = {
  waiting: "Waiting for review",
  approved: "Approved",
  sent_back: "Sent back",
} satisfies Record<SubmissionHeld["status"], string>;

/** What the Renter sent through their link that is still held, one row each. */
function submissionsSheet(
  submissions: readonly SubmissionHeld[],
  when: (moment: Date | null) => ExportCell,
): WorkbookSheet {
  const labels = submissions[0] ? detailTexts(submissions[0].sent).map((each) => each.label) : [];
  return {
    name: "Sent through link",
    table: [
      ["Sent", "Status", "Reviewed", "Note sent back", ...labels],
      ...submissions.map((submission) => [
        when(submission.sentAt),
        SUBMISSION_STATUS_LABELS[submission.status],
        when(submission.reviewedAt),
        submission.reviewNote ? text(submission.reviewNote) : null,
        ...detailTexts(submission.sent).map((each) => text(each.text || null)),
      ]),
    ],
  };
}

/** A stored file that goes into the download as it is: a document or a licence scan. */
export interface HeldFile {
  path: string;
  area: StorageArea;
  key: string;
}

export interface EverythingHeld {
  fileName: string;
  sheets: WorkbookSheet[];
  files: HeldFile[];
}

const SCAN_EXTENSIONS: Readonly<Record<string, string>> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function scanFiles(scans: readonly LicenceScanRecord[]): HeldFile[] {
  return scans.flatMap((scan) =>
    scan.stored
      ? [
          {
            path: `licence-scans/${scan.side}-${scan.id.slice(0, 8)}.${SCAN_EXTENSIONS[scan.stored.contentType] ?? "bin"}`,
            area: scan.stored.area,
            key: scan.stored.key,
          },
        ]
      : [],
  );
}

/**
 * Everything held about one Renter, for a Renter who asks what is held about
 * them (APP 12; review A7-8, A3-5): the sheets of one workbook, and the
 * stored documents and licence scans to send with it. The download itself is
 * logged against the Renter. Null if they are not the Operator's.
 */
export async function buildEverythingHeld(
  database: AnyDatabase,
  actor: ActingUser,
  renterId: string,
  timeZone: string,
): Promise<EverythingHeld | null> {
  const renter = await loadRenter(database, actor.operatorId, renterId);
  if (!renter) {
    return null;
  }
  const { operatorId } = actor;
  const isBusiness = renter.kind === "organisation";
  const linkIds = await listRenterLinkIds(database, operatorId, renterId);
  const [notes, scans, fileIds, noteIds, submissions, records, driverLinkIds] = await Promise.all([
    listNotes(database, operatorId, renterId, { isRemovedIncluded: true }),
    // A business has no licence (its drivers' are theirs): none of its files are scans.
    isBusiness ? [] : listAllLicenceScans(database, operatorId, renterId, linkIds),
    listRenterFileIds(database, operatorId, renterId, linkIds),
    listNoteIds(database, operatorId, renterId),
    listSubmissionsHeld(database, operatorId, renterId),
    withTenant(database, operatorId, (tx) => loadHeldRecords(tx, operatorId, renterId)),
    listDriverLinkIds(database, operatorId, renterId),
  ]);
  // A business: its drivers by name. A person: the cars they drove for a business.
  const [drivers, driving, drivesFor] = await Promise.all([
    isBusiness ? listBusinessDrivers(database, operatorId, renterId) : null,
    isBusiness
      ? null
      : withTenant(database, operatorId, (tx) => loadDrivingRecords(tx, operatorId, renterId)),
    isBusiness ? [] : listDrivesFor(database, operatorId, renterId),
  ]);
  const log = await loadRecordHistory(
    database,
    operatorId,
    [
      { entityType: ACTIVITY_ENTITY_TYPES.renter, entityIds: [renterId] },
      { entityType: ACTIVITY_ENTITY_TYPES.file, entityIds: fileIds },
      { entityType: ACTIVITY_ENTITY_TYPES.renterNote, entityIds: noteIds },
      { entityType: ACTIVITY_ENTITY_TYPES.renterLink, entityIds: linkIds },
      { entityType: ACTIVITY_ENTITY_TYPES.rental, entityIds: idsOf(records.rentals) },
      { entityType: ACTIVITY_ENTITY_TYPES.rentalChange, entityIds: idsOf(records.changes) },
      { entityType: ACTIVITY_ENTITY_TYPES.ledgerLine, entityIds: idsOf(records.lines) },
      { entityType: ACTIVITY_ENTITY_TYPES.bondMovement, entityIds: idsOf(records.bond) },
      { entityType: ACTIVITY_ENTITY_TYPES.billingDocument, entityIds: idsOf(records.billing) },
      { entityType: ACTIVITY_ENTITY_TYPES.paymentMandate, entityIds: idsOf(records.mandates) },
      { entityType: ACTIVITY_ENTITY_TYPES.payment, entityIds: idsOf(records.payments) },
      {
        entityType: ACTIVITY_ENTITY_TYPES.damageRecord,
        entityIds: records.damage.map(({ record }) => record.id),
      },
      { entityType: ACTIVITY_ENTITY_TYPES.issuedDocument, entityIds: idsOf(records.documents) },
      { entityType: ACTIVITY_ENTITY_TYPES.organisationDriver, entityIds: driverLinkIds },
    ],
    { isEverything: true },
  );
  await withTenant(database, operatorId, (tx) =>
    recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.renter,
      entityId: renterId,
      action: ACTIVITY_ACTIONS.exportedAll,
    }),
  );
  const when = (moment: Date | null): ExportCell =>
    moment ? formatDateTimeInTimeZone(moment, timeZone) : null;
  const personSheets = isBusiness
    ? [driversSheet(drivers?.drivers ?? [], timeZone)]
    : [licenceSheet(renter)];
  return {
    fileName: "renter-everything-held",
    sheets: [
      isBusiness ? businessDetailsSheet(renter, timeZone) : detailsSheet(renter, timeZone),
      ...personSheets,
      {
        name: "Notes",
        table: [
          ["Written", "By", "Note", "Removed"],
          ...notes.map((note) => [
            when(note.writtenAt),
            THE_BUSINESS,
            text(note.body),
            when(note.removedAt),
          ]),
        ],
      },
      {
        name: "Licence scans",
        table: [
          ["Side", "Kind", "Added", "Removed"],
          ...scans.map((scan) => [
            LICENCE_SIDE_LABELS[scan.side],
            scan.isSentThroughLink ? "Photo sent through a link" : "Licence scan",
            when(scan.addedAt),
            when(scan.removedAt),
          ]),
        ],
      },
      submissionsSheet(submissions, when),
      ...heldRecordSheets(records, timeZone),
      // Only for someone who drives, or drove, for a business.
      ...(driving && (driving.driven.length > 0 || drivesFor.length > 0)
        ? drivingSheets(driving, drivesFor, timeZone)
        : []),
      // A business's details have their own names: its full name is its legal name.
      logSheet(log, timeZone, isBusiness ? businessRenterFieldLabel : renterFieldLabel),
    ],
    files: [
      ...[...records.documents, ...(driving?.documents ?? [])].map((document) => ({
        path: heldDocumentFileName(document),
        area: document.storageArea,
        key: document.objectKey,
      })),
      ...scanFiles(scans),
    ],
  };
}

const idsOf = (rows: readonly { id: string }[]): string[] => rows.map((row) => row.id);
