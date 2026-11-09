import {
  formatDateTimeInTimeZone,
  handoverAcceptanceText,
  isHandoverAllowed,
  operatorSettingsSchema,
  readRenterSignature,
  readSettings,
  renterAbsentText,
  returnAcceptanceText,
  todayInTimeZone,
  type BookingProblem,
  type HandoverGap,
  type RenterSignature,
  type RenterSignatureInput,
} from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  inspectionDamageMarks,
  inspections,
  rentalDriverChanges,
  rentals,
  renters,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import { emailDocumentCopies } from "../contracts/document-copies";
import { recordIssuedDocument, storeDocumentPdf } from "../contracts/issued-documents";
import { rentalSummaryText } from "../contracts/signing-links";
import { recordDamageFromReturn } from "../damage/damage-records";
import {
  findDriverChangeProblems,
  lockDriverNamingParties,
  type MissingParty,
} from "../rentals/booking-checks";
import { driverChangeUnderWay, type DriverChange } from "../rentals/driver-change-under-way";
import { currentLinkOf } from "../renters/organisation-driver-records";
import { problemCodes, type RentalClock } from "../rentals/rental-records";
import { addReading } from "../vehicles/odometer";
import {
  assertChecklistUnchanged,
  ChecklistChangedError,
  checklistRefusal,
  FinishedAlreadyError,
} from "./checklist-report";
import { checklistFingerprint } from "./checklist-fingerprint";
import type { HandoverDependencies } from "./complete-handover";
import {
  HANDOVER_REPORT_TITLE,
  renderHandoverReport,
  reportOrPhotoMissing,
  type DriverChangeLine,
} from "./handover-report";
import { lockOpenInspection } from "./handover-records";
import {
  businessAcceptanceOf,
  checklistCopyParties,
  loadCompletedHandover,
  loadHandover,
  loadReturn,
  signerNameOf,
  type HandoverView,
} from "./handover-queries";
import { signatureColumns } from "./phone-signature";
import { endPossession, startPossession } from "./possession-records";
import { RETURN_REPORT_TITLE, renderReturnReport } from "./return-report";

/** What the signing step showed, sent back with the signatures (as a swap's, review A6-10). */
export interface ShownDriverChange {
  changeId: string;
  /** The check-in from the driver who had the car. */
  returnFingerprint: string;
  /** The car as the new driver takes it: the new driver, the business, the check-in. */
  handoverFingerprint: string;
}

export interface CompleteDriverChangeInput {
  shown: ShownDriverChange;
  /** The driver handing the car back, drawn or typed; null when they were not there. */
  outgoingSignature: RenterSignatureInput | null;
  /** The new driver, drawn or typed. */
  incomingSignature: RenterSignatureInput;
}

export type CompleteDriverChangeResult =
  | { status: "completed"; returnDocumentId: string; handoverDocumentId: string }
  | { status: "gaps"; gaps: HandoverGap[] }
  | { status: "lower"; lastKilometres: number }
  | { status: "refused"; problems: BookingProblem[] }
  | {
      status:
        | MissingParty
        | "not_found"
        | "no_signature"
        | "no_outgoing_signature"
        | "signature_required"
        | "finished_already"
        | "photo_missing"
        | "changed";
    };

/**
 * The driver change under way and its checklists: the check-in from the
 * driver who had the car, the handover it compares with, and the car as the
 * new driver takes it (that check-in, signed for by them).
 */
export interface DriverChangeViews {
  change: DriverChange;
  returned: HandoverView;
  before: HandoverView;
  takenOver: HandoverView;
}

/**
 * The car as the new driver takes it, while the change is under way: the
 * check-in's readings and photos, and the damage already on the car (at the
 * last handover, and found at the check-in), each photo stored once (rule
 * 21). Copied onto the new driver's own checklist as they sign.
 */
function takenOverView(
  handover: HandoverView,
  returned: HandoverView,
  before: HandoverView,
): HandoverView {
  return {
    ...handover,
    odometerKm: returned.odometerKm,
    fuelLevel: returned.fuelLevel,
    keysCount: returned.keysCount,
    accessories: returned.accessories,
    notes: returned.notes,
    damageMarks: [...before.damageMarks, ...returned.damageMarks],
    lastKilometres: returned.lastKilometres,
    gaps: returned.gaps,
  };
}

/** The change's views, read in `database` (a transaction, under its locks, when re-read there). */
async function readDriverChangeViews(
  database: HandoverDependencies["database"] | AnyTransaction,
  operatorId: string,
  change: DriverChange,
): Promise<DriverChangeViews | null> {
  const [returned, handover] = await Promise.all([
    loadReturn(database, operatorId, change.returnInspectionId),
    loadHandover(database, operatorId, change.handoverInspectionId),
  ]);
  const before = returned
    ? await loadCompletedHandover(database, operatorId, {
        rentalId: change.rentalId,
        vehicleId: returned.vehicleId,
      })
    : null;
  if (!returned || !handover || !before) {
    return null;
  }
  return { change, returned, before, takenOver: takenOverView(handover, returned, before) };
}

/** The rental's driver change under way, as its pages and its signing show it. */
export async function loadDriverChangeViews(
  deps: Pick<HandoverDependencies, "database">,
  operatorId: string,
  rentalId: string,
): Promise<DriverChangeViews | null> {
  const change = await withTenant(deps.database, operatorId, (tx) =>
    driverChangeUnderWay(tx, operatorId, rentalId),
  );
  return change ? readDriverChangeViews(deps.database, operatorId, change) : null;
}

/**
 * What stands between the new driver and the car now, read without a lock
 * for the signing page (signing checks again under its locks): the
 * business's link and the driver's own checks.
 */
export async function loadIncomingDriverProblems(
  deps: Pick<HandoverDependencies, "database">,
  operatorId: string,
  views: DriverChangeViews,
  clock: RentalClock,
): Promise<BookingProblem[] | MissingParty> {
  const { returned } = views;
  return withTenant(deps.database, operatorId, async (tx) => {
    const [driver] = await tx
      .select()
      .from(renters)
      .where(and(eq(renters.id, views.change.toDriverId), eq(renters.operatorId, operatorId)));
    if (!driver || driver.archivedAt) {
      return driver ? "driver_archived" : "driver_not_found";
    }
    if (!(await currentLinkOf(tx, operatorId, returned.renterId, driver.id, false))) {
      return "driver_not_current";
    }
    return findDriverChangeProblems(
      tx,
      driver,
      {
        id: returned.rentalId,
        plannedEnd: returned.plannedEnd,
        settingsSnapshot: returned.settingsSnapshot,
      },
      clock,
    );
  });
}

/** What the signing step sends back for the change as it stands. */
export function shownDriverChangeOf(views: DriverChangeViews): ShownDriverChange {
  return {
    changeId: views.change.id,
    returnFingerprint: checklistFingerprint(views.returned),
    handoverFingerprint: checklistFingerprint(views.takenOver),
  };
}

const isAsShown = (views: DriverChangeViews, shown: ShownDriverChange): boolean => {
  const now = shownDriverChangeOf(views);
  return (
    now.changeId === shown.changeId &&
    now.returnFingerprint === shown.returnFingerprint &&
    now.handoverFingerprint === shown.handoverFingerprint
  );
};

/** What stops the change being signed: another than shown, the check-in unfinished, a signature missing. */
function changeRefusal(
  views: DriverChangeViews,
  input: CompleteDriverChangeInput,
): CompleteDriverChangeResult | null {
  if (!isAsShown(views, input.shown)) {
    return { status: "changed" };
  }
  const unfinished = checklistRefusal(views.returned);
  if (unfinished) {
    return unfinished;
  }
  const settings = readSettings(operatorSettingsSchema, views.returned.settingsSnapshot);
  return input.outgoingSignature === null && settings.isRenterSignatureAtReturnRequired
    ? { status: "signature_required" }
    : null;
}

interface Signed {
  at: Date;
  atText: string;
  timeZone: string;
  outgoing: RenterSignature | null;
  incoming: RenterSignature;
}

/** Both drivers' signatures, each checked against their own name (rule 15); or what was wrong. */
function readSignatures(
  views: DriverChangeViews,
  input: CompleteDriverChangeInput,
): Pick<Signed, "outgoing" | "incoming"> | CompleteDriverChangeResult {
  const outgoing =
    input.outgoingSignature === null
      ? null
      : readRenterSignature(input.outgoingSignature, signerNameOf(views.returned) ?? "");
  if (input.outgoingSignature !== null && !outgoing) {
    return { status: "no_outgoing_signature" };
  }
  const incoming = readRenterSignature(
    input.incomingSignature,
    signerNameOf(views.takenOver) ?? "",
  );
  return incoming ? { outgoing, incoming } : { status: "no_signature" };
}

/** The words each driver accepts: the check-in (or that they were not there), and the car taken. */
function acceptanceOf(views: DriverChangeViews, signed: Signed): { old: string; new: string } {
  const facts = (view: HandoverView) => ({
    at: signed.at,
    timeZone: signed.timeZone,
    odometerKm: view.odometerKm ?? 0,
    fuelLevel: view.fuelLevel ?? "empty",
    forBusiness: businessAcceptanceOf(view),
  });
  return {
    old: signed.outgoing
      ? returnAcceptanceText(facts(views.returned))
      : renterAbsentText({ at: signed.at, timeZone: signed.timeZone, isBusinessDriver: true }),
    new: handoverAcceptanceText(facts(views.takenOver)),
  };
}

interface ChangePdfs {
  returnReport: Uint8Array;
  handoverReport: Uint8Array;
  acceptance: { old: string; new: string };
}

/** The check-in's return report (the driver who had the car) and the new driver's handover report. */
async function renderChangeReports(
  deps: HandoverDependencies,
  operatorId: string,
  views: DriverChangeViews,
  signed: Signed,
): Promise<ChangePdfs> {
  const acceptance = acceptanceOf(views, signed);
  const driverChange: DriverChangeLine = {
    fromName: views.returned.driverFullName ?? "",
    toName: views.takenOver.driverFullName ?? "",
    reason: views.change.reason,
  };
  const [returnReport, handoverReport] = await Promise.all([
    renderReturnReport(deps, operatorId, views.returned, {
      handover: views.before,
      returnedAtText: signed.atText,
      acceptanceText: acceptance.old,
      signature: signed.outgoing,
      signedAtText: signed.atText,
      driverChange,
    }),
    renderHandoverReport(deps, operatorId, views.takenOver, {
      atText: signed.atText,
      acceptanceText: acceptance.new,
      signature: signed.incoming,
      driverChange,
    }),
  ]);
  return { returnReport, handoverReport, acceptance };
}

/** Thrown inside the transaction when the new driver can no longer take the car: nothing is kept. */
class DriverChangeRefusedError extends Error {
  constructor(readonly result: CompleteDriverChangeResult) {
    super("The new driver can no longer take the car");
  }
}

/**
 * Under the locks, in "Lock order": the change, its two checklists (each
 * still as shown, re-read here), then the car (before the business, as a
 * booking of it takes them), the business and the new driver, whose
 * checks run once more, so a link removed, an archive or a Do not rent at
 * the same moment is waited for and then refuses the change in words.
 */
async function lockForSigning(
  tx: AnyTransaction,
  operatorId: string,
  views: DriverChangeViews,
  clock: RentalClock,
): Promise<BookingProblem[]> {
  const [locked] = await tx
    .select({ status: rentalDriverChanges.status })
    .from(rentalDriverChanges)
    .where(eq(rentalDriverChanges.id, views.change.id))
    .for("update");
  for (const inspectionId of [views.change.returnInspectionId, views.change.handoverInspectionId]) {
    if (
      locked?.status !== "in_progress" ||
      !(await lockOpenInspection(tx, operatorId, inspectionId))
    ) {
      throw new FinishedAlreadyError();
    }
  }
  const now = await readDriverChangeViews(tx, operatorId, views.change);
  if (!now || checklistFingerprint(now.takenOver) !== checklistFingerprint(views.takenOver)) {
    throw new ChecklistChangedError();
  }
  await assertChecklistUnchanged(tx, operatorId, views.returned);
  // The rental as re-read under its lock: its end may have moved since the phone's view.
  const { returned } = now;
  const parties = await lockDriverNamingParties(
    tx,
    operatorId,
    {
      renterId: returned.renterId,
      vehicleId: returned.vehicleId,
      driverId: views.change.toDriverId,
    },
    null,
  );
  if (typeof parties === "string" || !parties.driver) {
    throw new DriverChangeRefusedError({
      status: typeof parties === "string" ? parties : "driver_not_found",
    });
  }
  const problems = await findDriverChangeProblems(
    tx,
    parties.driver,
    {
      id: returned.rentalId,
      plannedEnd: returned.plannedEnd,
      settingsSnapshot: returned.settingsSnapshot,
    },
    clock,
  );
  if (!isHandoverAllowed(problems)) {
    throw new DriverChangeRefusedError({ status: "refused", problems });
  }
  return problems;
}

/**
 * Both checklists fixed with each driver's acceptance (rule 12). The new
 * driver's takes the check-in's readings and the damage already on the car:
 * marks only, each keeping in its key the mark whose photo it shows, so the
 * photo stays stored once (rule 21) and later checklists still show it.
 * Each copy and the checklist's finish are logged by record ids (rule 19).
 */
async function completeChecklists(
  tx: AnyTransaction,
  actor: ActingUser,
  views: DriverChangeViews,
  done: Signed & { acceptance: ChangePdfs["acceptance"] },
): Promise<void> {
  const { at } = done;
  await tx
    .update(inspections)
    .set({
      status: "completed",
      completedAt: at,
      acceptanceText: done.acceptance.old,
      ...signatureColumns(done.outgoing),
      isRenterAbsent: done.outgoing === null,
      updatedAt: at,
    })
    .where(eq(inspections.id, views.returned.inspectionId));
  const { takenOver } = views;
  for (const mark of takenOver.damageMarks) {
    const [copied] = await tx
      .insert(inspectionDamageMarks)
      .values({
        operatorId: actor.operatorId,
        inspectionId: takenOver.inspectionId,
        x: mark.x,
        y: mark.y,
        description: mark.description,
        clientKey: mark.photoMarkId,
        createdByUserId: actor.userId,
      })
      .returning({ id: inspectionDamageMarks.id });
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.damageMark,
      entityId: copied!.id,
      action: ACTIVITY_ACTIONS.created,
      valuesAfter: { inspectionId: takenOver.inspectionId, copiedFromMarkId: mark.id },
    });
  }
  await tx
    .update(inspections)
    .set({
      odometerKm: takenOver.odometerKm,
      fuelLevel: takenOver.fuelLevel,
      keysCount: takenOver.keysCount,
      accessories: takenOver.accessories,
      notes: takenOver.notes,
      status: "completed",
      completedAt: at,
      acceptanceText: done.acceptance.new,
      ...signatureColumns(done.incoming),
      updatedAt: at,
    })
    .where(eq(inspections.id, takenOver.inspectionId));
  await recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.inspection,
    entityId: takenOver.inspectionId,
    action: ACTIVITY_ACTIONS.accepted,
    valuesAfter: { status: "completed" },
  });
}

/**
 * Possession moves from one driver to the next at the same moment (rule
 * 15): the old one ends (its driver read under its lock, who must be the
 * one who checked in), the rental names the new driver (the database allows
 * it only for this change under way), and the new one starts. The `[)`
 * ranges meet, so the car's possessions never overlap and never leave a gap.
 */
async function movePossession(
  tx: AnyTransaction,
  actor: ActingUser,
  views: DriverChangeViews,
  at: Date,
): Promise<void> {
  const { change, returned } = views;
  const endedDriverId = await endPossession(tx, actor, {
    rentalId: change.rentalId,
    endedAt: at,
    returnInspectionId: returned.inspectionId,
    carRego: returned.carRego,
  });
  if (endedDriverId !== change.fromDriverId || endedDriverId !== returned.driverId) {
    throw new ChecklistChangedError();
  }
  await tx
    .update(rentals)
    .set({ driverId: change.toDriverId, updatedAt: at })
    .where(eq(rentals.id, change.rentalId));
  await startPossession(
    tx,
    actor,
    {
      rentalId: change.rentalId,
      vehicleId: returned.vehicleId,
      renterId: returned.renterId,
      driverId: change.toDriverId,
      startedAt: at,
      handoverInspectionId: views.takenOver.inspectionId,
    },
    returned.carRego,
  );
}

async function logChanged(
  tx: AnyTransaction,
  actor: ActingUser,
  views: DriverChangeViews,
  done: { isOutgoingAbsent: boolean; warnings: readonly BookingProblem[] },
): Promise<void> {
  const { change } = views;
  await recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.inspection,
    entityId: change.returnInspectionId,
    action: ACTIVITY_ACTIONS.accepted,
    valuesAfter: { status: "completed", isRenterAbsent: done.isOutgoingAbsent },
  });
  await recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.driverChange,
    entityId: change.id,
    action: ACTIVITY_ACTIONS.accepted,
    // The warnings it went ahead with, as a booking logs them (codes only).
    valuesAfter: {
      status: "completed",
      rentalId: change.rentalId,
      warnings: problemCodes(done.warnings),
    },
  });
  // Record ids only, never names (rule 7).
  await recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.rental,
    entityId: change.rentalId,
    action: ACTIVITY_ACTIONS.updated,
    valuesBefore: { driverId: change.fromDriverId },
    valuesAfter: { driverId: change.toDriverId },
  });
}

/** Everything the change does, in the one transaction that issues its two reports. */
async function recordDriverChanged(
  tx: AnyTransaction,
  actor: ActingUser,
  views: DriverChangeViews,
  done: Signed & { acceptance: ChangePdfs["acceptance"] },
): Promise<void> {
  const warnings = await lockForSigning(tx, actor.operatorId, views, {
    timeZone: done.timeZone,
    now: done.at,
  });
  await completeChecklists(tx, actor, views, done);
  await movePossession(tx, actor, views, done.at);
  const { returned } = views;
  await addReading(tx, actor, returned.vehicleId, returned.odometerKm ?? 0, {
    recordedAt: done.at,
    source: "return",
  });
  await recordDamageFromReturn(tx, actor, {
    inspectionId: returned.inspectionId,
    rentalId: returned.rentalId,
    vehicleId: returned.vehicleId,
    renterId: returned.renterId,
    foundOn: todayInTimeZone(done.at, done.timeZone),
  });
  await tx
    .update(rentalDriverChanges)
    .set({ status: "completed", changedAt: done.at, updatedAt: done.at })
    .where(eq(rentalDriverChanges.id, views.change.id));
  await logChanged(tx, actor, views, { isOutgoingAbsent: done.outgoing === null, warnings });
}

/** The two reports' ids, as issued. */
interface ChangeDocumentIds {
  returnReport: string;
  handoverReport: string;
}

/**
 * Each report to the business's contact and the Operator, and to the driver
 * who signed it, to their own email (rule 15): the check-in to the driver who
 * had the car, the handover to the new one.
 */
async function emailChangeReports(
  deps: HandoverDependencies,
  operatorId: string,
  views: DriverChangeViews,
  done: { atText: string; pdfs: ChangePdfs; documentIds: ChangeDocumentIds },
): Promise<void> {
  const { returned, takenOver } = views;
  const rentalSummary = rentalSummaryText({
    carRego: returned.carRego,
    carMakeModel: returned.carMakeModel,
    rentalStart: null,
  });
  const reports = [
    {
      view: returned,
      documentId: done.documentIds.returnReport,
      kind: "return_report" as const,
      title: RETURN_REPORT_TITLE,
      pdf: done.pdfs.returnReport,
    },
    {
      view: takenOver,
      documentId: done.documentIds.handoverReport,
      kind: "handover_report" as const,
      title: HANDOVER_REPORT_TITLE,
      pdf: done.pdfs.handoverReport,
    },
  ];
  for (const report of reports) {
    await emailDocumentCopies(deps, {
      operatorId,
      documentId: report.documentId,
      kind: report.kind,
      ...checklistCopyParties(report.view),
      rentalSummary,
      atText: done.atText,
      fileName: `${report.title} ${returned.carRego}.pdf`,
      pdf: report.pdf,
    });
  }
}

/** Stores both PDFs, then issues them in the one transaction that makes the change. */
async function issueChange(
  deps: HandoverDependencies,
  actor: ActingUser,
  views: DriverChangeViews,
  done: Signed & { pdfs: ChangePdfs },
): Promise<ChangeDocumentIds | null> {
  const rentalId = views.change.rentalId;
  const stored = await Promise.all([
    storeDocumentPdf(deps, actor, {
      rentalId,
      kind: "return_report",
      templateVersionId: null,
      inspectionId: views.returned.inspectionId,
      pdf: done.pdfs.returnReport,
    }),
    storeDocumentPdf(deps, actor, {
      rentalId,
      kind: "handover_report",
      templateVersionId: null,
      inspectionId: views.takenOver.inspectionId,
      pdf: done.pdfs.handoverReport,
    }),
  ]);
  const [returnStored, handoverStored] = stored;
  if (!returnStored || "status" in returnStored || !handoverStored || "status" in handoverStored) {
    return null;
  }
  return withTenant(deps.database, actor.operatorId, async (tx) => {
    const returnReport = await recordIssuedDocument(tx, deps, actor, returnStored);
    const handoverReport = await recordIssuedDocument(tx, deps, actor, handoverStored);
    await recordDriverChanged(tx, actor, views, { ...done, acceptance: done.pdfs.acceptance });
    return { returnReport: returnReport.documentId, handoverReport: handoverReport.documentId };
  });
}

/**
 * The drivers sign on the Operator's phone (decision 4): the one who had the
 * car (or the Operator records them as not there) and the new one. Both
 * reports are made and stored, then issued together (rule 12) in the one
 * transaction that fixes the checklists and moves possession from one driver
 * to the next at that moment (rule 15). Copies are emailed afterwards; the
 * rent, bond and contract stay as they are.
 */
export async function completeDriverChange(
  deps: HandoverDependencies,
  actor: ActingUser,
  rentalId: string,
  input: CompleteDriverChangeInput,
  clock: RentalClock,
): Promise<CompleteDriverChangeResult> {
  const views = await loadDriverChangeViews(deps, actor.operatorId, rentalId);
  if (!views) {
    return { status: "not_found" };
  }
  const refusal = changeRefusal(views, input);
  if (refusal) {
    return refusal;
  }
  const signatures = readSignatures(views, input);
  if ("status" in signatures) {
    return signatures;
  }
  const signed: Signed = {
    ...signatures,
    at: clock.now,
    atText: formatDateTimeInTimeZone(clock.now, clock.timeZone),
    timeZone: clock.timeZone,
  };
  const pdfs = await reportOrPhotoMissing(() =>
    renderChangeReports(deps, actor.operatorId, views, signed),
  );
  if ("status" in pdfs) {
    return pdfs;
  }
  let documentIds: ChangeDocumentIds | null;
  try {
    documentIds = await issueChange(deps, actor, views, { ...signed, pdfs });
  } catch (error) {
    if (error instanceof FinishedAlreadyError) {
      return { status: "finished_already" };
    }
    if (error instanceof ChecklistChangedError) {
      return { status: "changed" };
    }
    if (error instanceof DriverChangeRefusedError) {
      return error.result;
    }
    throw error;
  }
  if (!documentIds) {
    return { status: "not_found" };
  }
  // The change is done for good: emailing never throws, so it can't say otherwise (review G9-9).
  await emailChangeReports(deps, actor.operatorId, views, {
    atText: signed.atText,
    pdfs,
    documentIds,
  });
  return {
    status: "completed",
    returnDocumentId: documentIds.returnReport,
    handoverDocumentId: documentIds.handoverReport,
  };
}
