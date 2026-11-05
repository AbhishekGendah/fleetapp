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
} from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  carHolds,
  carSwaps,
  inspections,
  possessions,
  rentals,
  vehicles,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, isNull } from "drizzle-orm";

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
import { heldRange, isCarAlreadyHeld } from "../rentals/car-holds";
import { swapUnderWay, type CarSwap } from "../rentals/car-swaps";
import type { RentalClock } from "../rentals/rental-records";
import { loadBusinessDetails } from "../settings/business-details";
import type { VehicleStatusInput } from "../vehicles/vehicle-input";
import { addReading } from "../vehicles/odometer";
import { checklistRefusal, FinishedAlreadyError } from "./checklist-report";
import type { HandoverDependencies } from "./complete-handover";
import {
  HANDOVER_REPORT_TITLE,
  renderHandoverReport,
  reportOrPhotoMissing,
} from "./handover-report";
import { phoneSignature } from "./phone-signature";
import { lockOpenInspection } from "./handover-records";
import {
  loadCompletedHandover,
  loadHandover,
  loadReturn,
  type HandoverView,
} from "./handover-queries";
import { RETURN_REPORT_TITLE, renderReturnReport } from "./return-report";

export const SWAP_FORM_TITLE = "Car swap";

export interface CompleteSwapInput {
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
        | "finished_already"
        | "photo_missing";
    };

/** The swap's two checklists as they stand. */
interface SwapViews {
  swap: CarSwap;
  old: HandoverView;
  new: HandoverView;
}

async function loadSwapViews(
  deps: HandoverDependencies,
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

/** What stops the swap being finished: either checklist unfinished, or the old car's next status. */
function swapRefusal(views: SwapViews, input: CompleteSwapInput): CompleteSwapResult | null {
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

/** The swap form, filled from the business's template, with the Renter's signature. */
async function renderSwapForm(
  deps: HandoverDependencies,
  operatorId: string,
  views: SwapViews,
  moment: SwapMoment,
) {
  const template = await loadDefaultTemplate(deps.database, operatorId, "swap_form");
  if (!template) {
    return { status: "no_template" as const };
  }
  const filled = await fillContract(
    deps.database,
    operatorId,
    views.swap.rentalId,
    template.content,
    { timeZone: moment.timeZone, now: moment.at },
    {
      swapOldCar: carText(views.old),
      swapNewCar: carText(views.new),
      swapAt: moment.atText,
      swapReason: views.swap.reason,
    },
  );
  if (!filled || filled.missing.length > 0) {
    return { status: "missing" as const, fields: filled?.missing ?? [] };
  }
  const pdf = await renderDocumentPdf({
    ...(await loadPdfBranding(deps, operatorId)),
    title: `${SWAP_FORM_TITLE} ${views.new.carRego}`,
    document: filled.document,
    signature: phoneSignature(
      moment.signature,
      `Signed by ${views.new.renterFullName}`,
      moment.atText,
    ),
  });
  return { status: "ready" as const, pdf, templateVersionId: template.latestVersionId };
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
  moment: SwapMoment,
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

/** Both checklists fixed with the Renter's acceptance (rule 12). */
async function completeChecklists(
  tx: AnyTransaction,
  operatorId: string,
  views: SwapViews,
  accepted: { at: Date; acceptance: SwapPdfs["acceptance"] },
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
        updatedAt: accepted.at,
      })
      .where(eq(inspections.id, views[car].inspectionId));
  }
}

/** Possession moves from one car to the other at the same moment (rule 15). */
async function movePossession(
  tx: AnyTransaction,
  operatorId: string,
  views: SwapViews,
  at: Date,
): Promise<void> {
  await tx
    .update(possessions)
    .set({ endedAt: at, returnInspectionId: views.old.inspectionId, updatedAt: at })
    .where(
      and(
        eq(possessions.operatorId, operatorId),
        eq(possessions.rentalId, views.swap.rentalId),
        isNull(possessions.endedAt),
      ),
    );
  await tx.insert(possessions).values({
    operatorId,
    rentalId: views.swap.rentalId,
    vehicleId: views.new.vehicleId,
    renterId: views.new.renterId,
    startedAt: at,
    handoverInspectionId: views.new.inspectionId,
  });
}

/**
 * The old car's hold ends at the swap; the new car is held from then to the
 * rental's end (open-ended if it is ongoing or already past its end, until
 * the return). The database refuses a clash (rule 18).
 */
async function moveHold(
  tx: AnyTransaction,
  operatorId: string,
  views: SwapViews,
  at: Date,
): Promise<void> {
  await tx
    .update(carHolds)
    .set({ releasedAt: at, updatedAt: at })
    .where(
      and(
        eq(carHolds.operatorId, operatorId),
        eq(carHolds.rentalId, views.swap.rentalId),
        eq(carHolds.vehicleId, views.old.vehicleId),
        isNull(carHolds.releasedAt),
      ),
    );
  const end = views.new.plannedEnd && views.new.plannedEnd > at ? views.new.plannedEnd : null;
  try {
    await tx.transaction((savepoint) =>
      savepoint.insert(carHolds).values({
        operatorId,
        vehicleId: views.new.vehicleId,
        rentalId: views.swap.rentalId,
        heldDuring: heldRange(at, end),
      }),
    );
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
  await completeChecklists(tx, actor.operatorId, views, {
    at: done.at,
    acceptance: done.pdfs.acceptance,
  });
  await movePossession(tx, actor.operatorId, views, done.at);
  await moveHold(tx, actor.operatorId, views, done.at);
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

/** The three copies to the Renter and the business, once the swap is done. */
async function emailSwapCopies(
  deps: HandoverDependencies,
  operatorId: string,
  views: SwapViews,
  done: { atText: string; pdfs: SwapPdfs },
): Promise<void> {
  const business = await loadBusinessDetails(deps.database, operatorId);
  const shared = {
    operatorId,
    operatorName: business?.tradingName ?? business?.legalName ?? "",
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
    kind: "swap_form",
    rentalSummary: summaryOf(views.new),
    fileName: `${SWAP_FORM_TITLE} ${views.new.carRego}.pdf`,
    pdf: done.pdfs.swapForm,
  });
  await emailDocumentCopies(deps, {
    ...shared,
    kind: "return_report",
    rentalSummary: summaryOf(views.old),
    fileName: `${RETURN_REPORT_TITLE} ${views.old.carRego}.pdf`,
    pdf: done.pdfs.returnReport,
  });
  await emailDocumentCopies(deps, {
    ...shared,
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
    renderSwapDocuments(deps, actor.operatorId, views, moment),
  );
  if ("status" in pdfs) {
    return pdfs;
  }
  const stored = await storeSwapDocuments(deps, actor, views, pdfs);
  if (!stored) {
    return { status: "not_found" };
  }
  try {
    const swapDocumentId = await withTenant(deps.database, actor.operatorId, async (tx) => {
      const issued = [];
      for (const document of stored) {
        issued.push(await recordIssuedDocument(tx, deps, actor, document));
      }
      const swapDocument = issued.at(-1)!;
      await recordSwapped(tx, actor, views, {
        at,
        timeZone: clock.timeZone,
        pdfs,
        swapDocumentId: swapDocument.documentId,
        input,
      });
      return swapDocument.documentId;
    });
    await emailSwapCopies(deps, actor.operatorId, views, { atText: moment.atText, pdfs });
    return { status: "completed", swapDocumentId };
  } catch (error) {
    if (error instanceof FinishedAlreadyError) {
      return { status: "finished_already" };
    }
    if (error instanceof SwapClashError) {
      return { status: "clash" };
    }
    throw error;
  }
}
