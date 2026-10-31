import {
  countryName,
  formatCalendarDate,
  formatDateTimeInTimeZone,
  LICENCE_CLASS_LABELS,
  LICENCE_SIDE_LABELS,
  LICENCE_TYPE_LABELS,
  neutraliseSpreadsheetText,
  RENTER_STATUS_LABELS,
  type ExportCell,
} from "@fleetapp/core";
import type { WorkbookSheet } from "@fleetapp/core/spreadsheet";
import { describeActivity } from "@fleetapp/db/activity";
import type { AnyDatabase } from "@fleetapp/db/client";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";

import { recordUserChange, type ActingUser } from "../acting-user";
import { listRenterLinkIds } from "../renter-links/details-links";
import { detailTexts } from "../renter-links/review-rows";
import { listSubmissionsHeld, type SubmissionHeld } from "../renter-links/reviews";
import { loadRecordHistory, type HistoryEntry } from "../record-history";
import { listAllLicenceScans, listRenterFileIds } from "./licence-scans";
import { listNoteIds, listNotes } from "./notes";
import { RENTER_FIELD_LABELS, renterFieldLabel } from "./renter-labels";
import { loadRenter, type RenterDetail } from "./renter-queries";

const NOT_GIVEN = "Not given";

/** Text as a cell that cannot run as a formula when the file is opened. */
function text(value: string | null | undefined): ExportCell {
  return value ? neutraliseSpreadsheetText(value) : NOT_GIVEN;
}

function fieldRows(lines: readonly [string, string | null][]): ExportCell[][] {
  return [["Detail", "On file"], ...lines.map(([label, value]) => [label, text(value)])];
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
      [labels.status, RENTER_STATUS_LABELS[renter.status]],
      [labels.doNotRentReason, renter.doNotRentReason],
      ["Added", formatDateTimeInTimeZone(renter.createdAt, timeZone)],
      ["Archived", renter.archivedAt && formatDateTimeInTimeZone(renter.archivedAt, timeZone)],
    ]),
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
function changedFields(entry: HistoryEntry): string {
  const fields = Object.keys(entry.valuesBefore ?? {});
  return fields.map(renterFieldLabel).join(", ");
}

function logSheet(entries: readonly HistoryEntry[], timeZone: string): WorkbookSheet {
  return {
    name: "Log",
    table: [
      ["When", "Who", "What", "Details changed"],
      ...entries.map((entry) => [
        formatDateTimeInTimeZone(entry.occurredAt, timeZone),
        text(entry.actorName ?? entry.actorType),
        describeActivity(entry.entityType, entry.action, entry.valuesAfter),
        text(changedFields(entry) || null),
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

/**
 * Everything held about one Renter, as the sheets of one Excel file: for a
 * Renter who asks what is held about them (APP 12). The download itself is
 * logged against the Renter. Null if they are not the Operator's.
 */
export async function buildEverythingHeld(
  database: AnyDatabase,
  actor: ActingUser,
  renterId: string,
  timeZone: string,
): Promise<{ fileName: string; sheets: WorkbookSheet[] } | null> {
  const renter = await loadRenter(database, actor.operatorId, renterId);
  if (!renter) {
    return null;
  }
  const { operatorId } = actor;
  const [notes, scans, fileIds, noteIds, linkIds, submissions] = await Promise.all([
    listNotes(database, operatorId, renterId, { isRemovedIncluded: true }),
    listAllLicenceScans(database, operatorId, renterId),
    listRenterFileIds(database, operatorId, renterId),
    listNoteIds(database, operatorId, renterId),
    listRenterLinkIds(database, operatorId, renterId),
    listSubmissionsHeld(database, operatorId, renterId),
  ]);
  const log = await loadRecordHistory(
    database,
    operatorId,
    [
      { entityType: ACTIVITY_ENTITY_TYPES.renter, entityIds: [renterId] },
      { entityType: ACTIVITY_ENTITY_TYPES.file, entityIds: fileIds },
      { entityType: ACTIVITY_ENTITY_TYPES.renterNote, entityIds: noteIds },
      { entityType: ACTIVITY_ENTITY_TYPES.renterLink, entityIds: linkIds },
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
  return {
    fileName: "renter-everything-held",
    sheets: [
      detailsSheet(renter, timeZone),
      licenceSheet(renter),
      {
        name: "Notes",
        table: [
          ["Written", "By", "Note", "Removed"],
          ...notes.map((note) => [
            when(note.writtenAt),
            text(note.writtenBy),
            text(note.body),
            when(note.removedAt),
          ]),
        ],
      },
      {
        name: "Licence scans",
        table: [
          ["Side", "Added", "Removed"],
          ...scans.map((scan) => [
            LICENCE_SIDE_LABELS[scan.side],
            when(scan.addedAt),
            when(scan.removedAt),
          ]),
        ],
      },
      submissionsSheet(submissions, when),
      logSheet(log, timeZone),
    ],
  };
}
