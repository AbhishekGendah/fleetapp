import {
  readRenterSignature,
  type RenterSignature,
  type RenterSignatureInput,
  formatDateTimeInTimeZone,
  handoverAcceptanceText,
  returnAcceptanceText,
  STATUSES_AFTER_SWAP,
  todayInTimeZone,
  type HandoverGap,
  type MergeFieldKey,
  type TemplateDocument,
} from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  carHolds,
  carSwaps,
  inspections,
  rentals,
  vehicles,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { eq } from "drizzle-orm";

import { lockCurrentVehicle } from "../vehicles/current-vehicle";
import { recordUserChange, type ActingUser } from "../acting-user";
import { loadPdfBranding } from "../contracts/contract-pdf";
import { emailDocumentCopies } from "../contracts/document-copies";
import { renderDocumentPdf } from "../contracts/document-pdf";
import { fillContract } from "../contracts/filled-contract";
import {
  recordIssuedDocument,
  storeDocumentPdf,
  type StoredDocument,
} from "../contracts/issued-documents";
import { rentalSummaryText } from "../contracts/signing-links";
import { loadDefaultTemplate } from "../contracts/templates";
import { recordDamageFromReturn } from "../damage/damage-records";
import { heldRange, isCarAlreadyHeld, releaseCarHolds } from "../rentals/car-holds";
import { swapUnderWay, type CarSwap } from "../rentals/car-swaps";
import type { RentalClock } from "../rentals/rental-records";
import type { VehicleStatusInput } from "../vehicles/vehicle-input";
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
} from "./handover-report";
import { phoneSignature, signatureColumns } from "./phone-signature";
import { endPossession, startPossession } from "./possession-records";
import { lockOpenInspection } from "./handover-records";
import {
  loadCompletedHandover,
  loadHandover,
  loadReturn,
  type HandoverView,
} from "./handover-queries";
import { RETURN_REPORT_TITLE, renderReturnReport } from "./return-report";

export const SWAP_FORM_TITLE = "Car swap";

/** What the swap's signing step showed, sent back with the signature (review A6-10, A6-11, G9-1). */
export interface ShownSwap {
  swapId: string;
  returnFingerprint: string;
  handoverFingerprint: string;
  /** The swap form's template version the Renter read. */
  swapTemplateVersionId: string;
  /** The fingerprint of the filled-in swap form the Renter read (review G9-1). */
  swapFormFingerprint: string;
}

export interface CompleteSwapInput {
  shown: ShownSwap;
  /** The Renter's signature on the Operator's phone, drawn or typed, as the form sent it. */
  signature: RenterSignatureInput;
  /** Where the old car goes: Available, In service or Off road. */
  oldCarAfter: VehicleStatusInput;
}

type SwapCar = "old" | "new";

export type CompleteSwapResult =
  | { status: "completed"; swapDocumentId: string }
  | { status: "gaps"; car: SwapCar; gaps: HandoverGap[] }
  | { status: "lower"; car: SwapCar; lastKilometres: number }
  | { status: "missing"; fields: MergeFieldKey[] }
  | {
      status:
        | "not_found"
        | "no_signature"
        | "no_template"
        | "car_status"
        | "clash"
        | "new_car_changed"
        | "finished_already"
        | "photo_missing"
        | "changed"
        | "form_changed";
    };

/** The swap's two checklists as they stand. */
interface SwapViews {
  swap: CarSwap;
  old: HandoverView;
  new: HandoverView;
}

async function loadSwapViews(
  deps: Pick<HandoverDependencies, "database">,
  operatorId: string,
  rentalId: string,
): Promise<SwapViews | null> {
  const swap = await withTenant(deps.database, operatorId, (tx) =>
    swapUnderWay(tx, operatorId, rentalId),
  );
  if (!swap) {
    return null;
  }
  const [oldView, newView] = await Promise.all([
    loadReturn(deps.database, operatorId, swap.returnInspectionId),
    loadHandover(deps.database, operatorId, swap.handoverInspectionId),
  ]);
  return oldView && newView ? { swap, old: oldView, new: newView } : null;
}

/** What stops the swap being finished: another swap or checklist than the one shown, either checklist unfinished, or the old car's next status. */
function swapRefusal(views: SwapViews, input: CompleteSwapInput): CompleteSwapResult | null {
  const isAsShown =
    views.swap.id === input.shown.swapId &&
    checklistFingerprint(views.old) === input.shown.returnFingerprint &&
    checklistFingerprint(views.new) === input.shown.handoverFingerprint;
  if (!isAsShown) {
    return { status: "changed" };
  }
  for (const car of ["old", "new"] as const) {
    const refusal = checklistRefusal(views[car]);
    if (refusal) {
      return { ...refusal, car };
    }
  }
  return STATUSES_AFTER_SWAP.some((status) => status === input.oldCarAfter.status)
    ? null
    : { status: "car_status" };
}

interface SwapMoment {
  at: Date;
  atText: string;
  timeZone: string;
  signature: RenterSignature;
}

const carText = (view: HandoverView): string => `${view.carRego} ${view.carMakeModel}`;

/** Said in the swap form's "when" before the Renter signs: the time is put in as they sign. */
export const SWAP_AT_SIGNING_TEXT = "the date and time the Renter signs";

type FilledSwapForm =
  | { status: "filled"; document: TemplateDocument; templateVersionId: string; fingerprint: string }
  | { status: "no_template" }
  | { status: "missing"; fields: MergeFieldKey[] };

/** The business's swap form, filled in for this swap: what is shown before signing and printed after. */
async function fillSwapForm(
  deps: Pick<HandoverDependencies, "database">,
  operatorId: string,
  views: SwapViews,
  clock: { timeZone: string; atText: string },
): Promise<FilledSwapForm> {
  const template = await loadDefaultTemplate(deps.database, operatorId, "swap_form");
  if (!template) {
    return { status: "no_template" };
  }
  const filled = await fillContract(
    deps.database,
    operatorId,
    views.swap.rentalId,
    template.content,
    // Dated from the swap's start, so the form shown and the form printed read the same.
    { timeZone: clock.timeZone, now: views.swap.createdAt },
    {
      swapOldCar: carText(views.old),
      swapNewCar: carText(views.new),
      swapAt: clock.atText,
      swapReason: views.swap.reason,
    },
    // The car the Renter receives, not the one handed back (review G4-3).
    { vehicleId: views.new.vehicleId },
  );
  if (!filled || filled.missing.length > 0) {
    return { status: "missing", fields: filled?.missing ?? [] };
  }
  return {
    status: "filled",
    document: filled.document,
    templateVersionId: template.latestVersionId,
    fingerprint: filled.fingerprint,
  };
}

/** What the swap's signing step shows: the filled swap form, and the checklists as saved. */
export interface SwapSigningView {
  swapId: string;
  form: FilledSwapForm;
  returned: HandoverView;
  handedOver: HandoverView;
}

export async function loadSwapSigningView(
  deps: Pick<HandoverDependencies, "database">,
  operatorId: string,
  rentalId: string,
  clock: RentalClock,
): Promise<SwapSigningView | null> {
  const views = await loadSwapViews(deps, operatorId, rentalId);
  if (!views) {
    return null;
  }
  const form = await fillSwapForm(deps, operatorId, views, {
    timeZone: clock.timeZone,
    atText: SWAP_AT_SIGNING_TEXT,
  });
  return { swapId: views.swap.id, form, returned: views.old, handedOver: views.new };
}

/** What a signing step would send back for the swap as it stands: for code signing on a Renter's behalf (demos, tests). */
export async function currentShownSwap(
  deps: Pick<HandoverDependencies, "database">,
  operatorId: string,
  rentalId: string,
  clock: RentalClock,
): Promise<ShownSwap | null> {
  const view = await loadSwapSigningView(deps, operatorId, rentalId, clock);
  if (!view || view.form.status !== "filled") {
    return null;
  }
  return {
    swapId: view.swapId,
    returnFingerprint: checklistFingerprint(view.returned),
    handoverFingerprint: checklistFingerprint(view.handedOver),
    swapTemplateVersionId: view.form.templateVersionId,
    swapFormFingerprint: view.form.fingerprint,
  };
}

/** The swap form, filled from the template version the Renter read, with their signature. */
async function renderSwapForm(
  deps: HandoverDependencies,
  operatorId: string,
  views: SwapViews,
  moment: SwapMoment & { shown: ShownSwap },
) {
  // The form as the Renter read it (time still in words): it must be the same now (review G9-1).
  const asRead = await fillSwapForm(deps, operatorId, views, {
    timeZone: moment.timeZone,
    atText: SWAP_AT_SIGNING_TEXT,
  });
  if (asRead.status !== "filled") {
    return asRead;
  }
  if (
    asRead.templateVersionId !== moment.shown.swapTemplateVersionId ||
    asRead.fingerprint !== moment.shown.swapFormFingerprint
  ) {
    return { status: "form_changed" as const };
  }
  const form = await fillSwapForm(deps, operatorId, views, {
    timeZone: moment.timeZone,
    atText: moment.atText,
  });
  if (form.status !== "filled") {
    return form;
  }
  const pdf = await renderDocumentPdf({
    ...(await loadPdfBranding(deps, operatorId)),
    title: `${SWAP_FORM_TITLE} ${views.new.carRego}`,
    document: form.document,
    signature: phoneSignature(
      moment.signature,
      `Signed by ${views.new.renterFullName}`,
      moment.atText,
    ),
  });
  return { status: "ready" as const, pdf, templateVersionId: form.templateVersionId };
}

interface SwapPdfs {
  returnReport: Uint8Array;
  handoverReport: Uint8Array;
  swapForm: Uint8Array;
  swapTemplateVersionId: string;
  acceptance: { old: string; new: string };
}

/** The three documents a swap issues: the old car's return report, the new car's handover report, the swap form. */
async function renderSwapDocuments(
  deps: HandoverDependencies,
  operatorId: string,
  views: SwapViews,
  moment: SwapMoment & { shown: ShownSwap },
): Promise<SwapPdfs | Exclude<CompleteSwapResult, { status: "completed" }>> {
  const form = await renderSwapForm(deps, operatorId, views, moment);
  if (form.status !== "ready") {
    return form;
  }
  const oldHandover = await loadCompletedHandover(deps.database, operatorId, {
    rentalId: views.swap.rentalId,
    vehicleId: views.old.vehicleId,
  });
  if (!oldHandover) {
    return { status: "not_found" };
  }
  const facts = (view: HandoverView) => ({
    at: moment.at,
    timeZone: moment.timeZone,
    odometerKm: view.odometerKm ?? 0,
    fuelLevel: view.fuelLevel ?? "empty",
  });
  const acceptance = {
    old: returnAcceptanceText(facts(views.old)),
    new: handoverAcceptanceText(facts(views.new)),
  };
  const [returnReport, handoverReport] = await Promise.all([
    renderReturnReport(deps, operatorId, views.old, {
      handover: oldHandover,
      returnedAtText: moment.atText,
      acceptanceText: acceptance.old,
      signature: moment.signature,
      signedAtText: moment.atText,
    }),
    renderHandoverReport(deps, operatorId, views.new, {
      atText: moment.atText,
      acceptanceText: acceptance.new,
      signature: moment.signature,
    }),
  ]);
  return {
    returnReport,
    handoverReport,
    swapForm: form.pdf,
    swapTemplateVersionId: form.templateVersionId,
    acceptance,
  };
}

/** Thrown inside the transaction when the new car was booked by someone else meanwhile. */
class SwapClashError extends Error {}

/** The car going out was sold, sent to the workshop or archived since the swap began: nothing is kept. */
class NewCarChangedError extends Error {}

/** Both checklists fixed with the Renter's acceptance (rule 12). */
async function completeChecklists(
  tx: AnyTransaction,
  operatorId: string,
  views: SwapViews,
  accepted: { at: Date; acceptance: SwapPdfs["acceptance"]; signature: RenterSignature },
): Promise<void> {
  for (const car of ["old", "new"] as const) {
    if (!(await lockOpenInspection(tx, operatorId, views[car].inspectionId))) {
      throw new FinishedAlreadyError();
    }
    await tx
      .update(inspections)
      .set({
        status: "completed",
        completedAt: accepted.at,
        acceptanceText: accepted.acceptance[car],
        ...signatureColumns(accepted.signature),
        updatedAt: accepted.at,
      })
      .where(eq(inspections.id, views[car].inspectionId));
  }
}

/** Possession moves from one car to the other at the same moment (rule 15). */
async function movePossession(
  tx: AnyTransaction,
  actor: ActingUser,
  views: SwapViews,
  at: Date,
): Promise<void> {
  await endPossession(tx, actor, {
    rentalId: views.swap.rentalId,
    endedAt: at,
    returnInspectionId: views.old.inspectionId,
    carRego: views.old.carRego,
  });
  await startPossession(
    tx,
    actor,
    {
      rentalId: views.swap.rentalId,
      vehicleId: views.new.vehicleId,
      renterId: views.new.renterId,
      startedAt: at,
      handoverInspectionId: views.new.inspectionId,
    },
    views.new.carRego,
  );
}

/**
 * The old car's hold ends at the swap; the new car is held from then to the
 * rental's end (open-ended if it is ongoing or already past its end, until
 * the return). The database refuses a clash (rule 18).
 */
async function moveHold(
  tx: AnyTransaction,
  actor: ActingUser,
  views: SwapViews,
  at: Date,
): Promise<void> {
  await releaseCarHolds(tx, actor, views.swap.rentalId, at, views.old.vehicleId);
  const end = views.new.plannedEnd && views.new.plannedEnd > at ? views.new.plannedEnd : null;
  try {
    const [held] = await tx.transaction((savepoint) =>
      savepoint
        .insert(carHolds)
        .values({
          operatorId: actor.operatorId,
          vehicleId: views.new.vehicleId,
          rentalId: views.swap.rentalId,
          heldDuring: heldRange(at, end),
        })
        .returning({ id: carHolds.id }),
    );
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.carHold,
      entityId: held!.id,
      action: ACTIVITY_ACTIONS.created,
      valuesAfter: { carRego: views.new.carRego },
    });
  } catch (error) {
    if (isCarAlreadyHeld(error)) {
      throw new SwapClashError();
    }
    throw error;
  }
}

/** The cars' statuses and kilometres, and the rental now on the new car. */
async function moveCars(
  tx: AnyTransaction,
  actor: ActingUser,
  views: SwapViews,
  change: { at: Date; oldCarAfter: VehicleStatusInput },
): Promise<void> {
  const { at } = change;
  await tx
    .update(rentals)
    .set({ vehicleId: views.new.vehicleId, updatedAt: at })
    .where(eq(rentals.id, views.swap.rentalId));
  await tx
    .update(vehicles)
    .set({ ...change.oldCarAfter, updatedAt: at })
    .where(eq(vehicles.id, views.old.vehicleId));
  await tx
    .update(vehicles)
    .set({ status: "rented", statusReason: null, statusExpectedBack: null, updatedAt: at })
    .where(eq(vehicles.id, views.new.vehicleId));
  await addReading(tx, actor, views.old.vehicleId, views.old.odometerKm ?? 0, {
    recordedAt: at,
    source: "return",
  });
  await addReading(tx, actor, views.new.vehicleId, views.new.odometerKm ?? 0, {
    recordedAt: at,
    source: "handover",
  });
}

async function logSwapped(
  tx: AnyTransaction,
  actor: ActingUser,
  views: SwapViews,
  oldCarStatus: string,
): Promise<void> {
  await recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.carSwap,
    entityId: views.swap.id,
    action: ACTIVITY_ACTIONS.accepted,
    valuesAfter: { status: "completed", rentalId: views.swap.rentalId },
  });
  await recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.rental,
    entityId: views.swap.rentalId,
    action: ACTIVITY_ACTIONS.updated,
    valuesBefore: { vehicleId: views.old.vehicleId },
    valuesAfter: { vehicleId: views.new.vehicleId },
  });
  for (const [vehicleId, status] of [
    [views.old.vehicleId, oldCarStatus],
    [views.new.vehicleId, "rented"],
  ] as const) {
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.vehicle,
      entityId: vehicleId,
      action: ACTIVITY_ACTIONS.statusChanged,
      valuesAfter: { status },
    });
  }
}

/** Everything the swap changes, in the one transaction that issues its three documents. */
async function recordSwapped(
  tx: AnyTransaction,
  actor: ActingUser,
  views: SwapViews,
  done: {
    at: Date;
    timeZone: string;
    pdfs: SwapPdfs;
    swapDocumentId: string;
    input: CompleteSwapInput;
    signature: RenterSignature;
  },
): Promise<void> {
  const [locked] = await tx
    .select({ status: carSwaps.status })
    .from(carSwaps)
    .where(eq(carSwaps.id, views.swap.id))
    .for("update");
  if (locked?.status !== "in_progress") {
    throw new FinishedAlreadyError();
  }
  // Locked as a handover locks its car, so a sale at the same moment waits and then sees it Rented (review A8-4).
  const newCar = await lockCurrentVehicle(tx, actor.operatorId, views.new.vehicleId);
  if (newCar?.status !== "available") {
    throw new NewCarChangedError();
  }
  await completeChecklists(tx, actor.operatorId, views, {
    at: done.at,
    acceptance: done.pdfs.acceptance,
    signature: done.signature,
  });
  // Under the locks: the checklists are still the ones the reports were made from (review A6-10).
  await assertChecklistUnchanged(tx, actor.operatorId, views.old);
  await assertChecklistUnchanged(tx, actor.operatorId, views.new);
  await movePossession(tx, actor, views, done.at);
  await moveHold(tx, actor, views, done.at);
  await moveCars(tx, actor, views, { at: done.at, oldCarAfter: done.input.oldCarAfter });
  await recordDamageFromReturn(tx, actor, {
    inspectionId: views.old.inspectionId,
    rentalId: views.swap.rentalId,
    vehicleId: views.old.vehicleId,
    renterId: views.old.renterId,
    foundOn: todayInTimeZone(done.at, done.timeZone),
  });
  await tx
    .update(carSwaps)
    .set({
      status: "completed",
      swappedAt: done.at,
      documentId: done.swapDocumentId,
      fromVehicleStatusAfter: done.input.oldCarAfter.status,
      updatedAt: done.at,
    })
    .where(eq(carSwaps.id, views.swap.id));
  await logSwapped(tx, actor, views, done.input.oldCarAfter.status);
}

/** Stores the three PDFs before the transaction that issues them. */
async function storeSwapDocuments(
  deps: HandoverDependencies,
  actor: ActingUser,
  views: SwapViews,
  pdfs: SwapPdfs,
): Promise<StoredDocument[] | null> {
  const rentalId = views.swap.rentalId;
  const stored = await Promise.all([
    storeDocumentPdf(deps, actor, {
      rentalId,
      kind: "return_report",
      templateVersionId: null,
      inspectionId: views.old.inspectionId,
      pdf: pdfs.returnReport,
    }),
    storeDocumentPdf(deps, actor, {
      rentalId,
      kind: "handover_report",
      templateVersionId: null,
      inspectionId: views.new.inspectionId,
      pdf: pdfs.handoverReport,
    }),
    storeDocumentPdf(deps, actor, {
      rentalId,
      kind: "swap_form",
      templateVersionId: pdfs.swapTemplateVersionId,
      pdf: pdfs.swapForm,
    }),
  ]);
  const ready = stored.filter((document): document is StoredDocument => !("status" in document));
  return ready.length === stored.length ? ready : null;
}

/** The three documents a swap issues, in the order they are stored. */
interface SwapDocumentIds {
  returnReport: string;
  handoverReport: string;
  swapForm: string;
}

/** The three copies to the Renter and the business, once the swap is done. */
async function emailSwapCopies(
  deps: HandoverDependencies,
  operatorId: string,
  views: SwapViews,
  done: { atText: string; pdfs: SwapPdfs; documentIds: SwapDocumentIds },
): Promise<void> {
  const shared = {
    operatorId,
    renterEmail: views.new.renterEmail,
    renterName: views.new.renterFullName,
    atText: done.atText,
  };
  const summaryOf = (view: HandoverView) =>
    rentalSummaryText({
      carRego: view.carRego,
      carMakeModel: view.carMakeModel,
      rentalStart: null,
    });
  await emailDocumentCopies(deps, {
    ...shared,
    documentId: done.documentIds.swapForm,
    kind: "swap_form",
    rentalSummary: summaryOf(views.new),
    fileName: `${SWAP_FORM_TITLE} ${views.new.carRego}.pdf`,
    pdf: done.pdfs.swapForm,
  });
  await emailDocumentCopies(deps, {
    ...shared,
    documentId: done.documentIds.returnReport,
    kind: "return_report",
    rentalSummary: summaryOf(views.old),
    fileName: `${RETURN_REPORT_TITLE} ${views.old.carRego}.pdf`,
    pdf: done.pdfs.returnReport,
  });
  await emailDocumentCopies(deps, {
    ...shared,
    documentId: done.documentIds.handoverReport,
    kind: "handover_report",
    rentalSummary: summaryOf(views.new),
    fileName: `${HANDOVER_REPORT_TITLE} ${views.new.carRego}.pdf`,
    pdf: done.pdfs.handoverReport,
  });
}

/**
 * The Renter signs the swap on the Operator's phone: both checklists are
 * checked once more, the three documents are made and stored, then issued
 * together (rule 12) in the one transaction that fixes the checklists,
 * moves possession (rule 15), the holds (rule 18), the cars and the rental
 * to the new car. Copies are emailed afterwards.
 */
export async function completeSwap(
  deps: HandoverDependencies,
  actor: ActingUser,
  rentalId: string,
  input: CompleteSwapInput,
  clock: RentalClock,
): Promise<CompleteSwapResult> {
  const views = await loadSwapViews(deps, actor.operatorId, rentalId);
  if (!views) {
    return { status: "not_found" };
  }
  const refusal = swapRefusal(views, input);
  if (refusal) {
    return refusal;
  }
  const signature = readRenterSignature(input.signature, views.new.renterFullName);
  if (!signature) {
    return { status: "no_signature" };
  }
  const at = clock.now;
  const moment = {
    at,
    atText: formatDateTimeInTimeZone(at, clock.timeZone),
    timeZone: clock.timeZone,
    signature,
  };
  const pdfs = await reportOrPhotoMissing(() =>
    renderSwapDocuments(deps, actor.operatorId, views, {
      ...moment,
      shown: input.shown,
    }),
  );
  if ("status" in pdfs) {
    return pdfs;
  }
  const stored = await storeSwapDocuments(deps, actor, views, pdfs);
  if (!stored) {
    return { status: "not_found" };
  }
  let documentIds: SwapDocumentIds;
  try {
    documentIds = await withTenant(deps.database, actor.operatorId, async (tx) => {
      const issued = [];
      for (const document of stored) {
        issued.push((await recordIssuedDocument(tx, deps, actor, document)).documentId);
      }
      const ids = { returnReport: issued[0]!, handoverReport: issued[1]!, swapForm: issued[2]! };
      await recordSwapped(tx, actor, views, {
        at,
        timeZone: clock.timeZone,
        pdfs,
        swapDocumentId: ids.swapForm,
        input,
        signature,
      });
      return ids;
    });
  } catch (error) {
    if (error instanceof FinishedAlreadyError) {
      return { status: "finished_already" };
    }
    if (error instanceof SwapClashError) {
      return { status: "clash" };
    }
    if (error instanceof NewCarChangedError) {
      return { status: "new_car_changed" };
    }
    if (error instanceof ChecklistChangedError) {
      return { status: "changed" };
    }
    throw error;
  }
  // The swap is done for good: emailing never throws, so it can't say otherwise (review G9-9).
  await emailSwapCopies(deps, actor.operatorId, views, {
    atText: moment.atText,
    pdfs,
    documentIds,
  });
  return { status: "completed", swapDocumentId: documentIds.swapForm };
}
