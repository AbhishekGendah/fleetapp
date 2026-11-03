import { chargeRentNow } from "../ledger/rent-job";
import {
  decodeDrawnSignature,
  formatDateTimeInTimeZone,
  handoverAcceptanceText,
  type BookingProblem,
  type HandoverGap,
} from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  inspections,
  possessions,
  rentals,
  vehicles,
} from "@fleetapp/db/schema";
import type { EmailSender } from "@fleetapp/email";
import { eq } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import { emailDocumentCopies } from "../contracts/document-copies";
import { loadSigningStatus, rentalSummaryText } from "../contracts/signing-links";
import type { FileDependencies } from "../files/stored-files";
import { loadRentalProblems } from "../rentals/booking-checks";
import type { RentalClock } from "../rentals/rental-records";
import { loadBusinessDetails } from "../settings/business-details";
import { addReading } from "../vehicles/odometer";
import { checklistRefusal, FinishedAlreadyError, issueChecklistReport } from "./checklist-report";
import { lockOpenInspection } from "./handover-records";
import { loadHandover, type HandoverView } from "./handover-queries";
import { HANDOVER_REPORT_TITLE, renderHandoverReport } from "./handover-report";

export interface CompleteHandoverInput {
  /** The Renter's signature drawn on the Operator's phone, as a PNG data URL. */
  drawnSignature: string;
  /** Why the car goes before the full bond is held, when the rental's rules want it first. */
  bondOverrideReason: string | null;
}

export type CompleteHandoverResult =
  | { status: "completed"; documentId: string }
  | { status: "gaps"; gaps: HandoverGap[] }
  | { status: "blocked"; problems: BookingProblem[] }
  | { status: "bond_short"; owingCents: number }
  | { status: "lower"; lastKilometres: number }
  | {
      status: "not_found" | "contract_unsigned" | "no_signature" | "finished_already";
    };

export interface HandoverDependencies extends FileDependencies {
  emailSender: EmailSender;
}

/**
 * What stops the Renter accepting now: anything missing from the checklist,
 * an unsigned contract, a handover problem (licence, car not ready), the
 * kilometres below the car's last reading, or bond short with no reason.
 */
async function acceptanceRefusal(
  deps: HandoverDependencies,
  operatorId: string,
  view: HandoverView,
  input: CompleteHandoverInput,
  clock: RentalClock,
): Promise<CompleteHandoverResult | null> {
  const unfinished = checklistRefusal(view);
  if (unfinished) {
    return unfinished;
  }
  const signing = await loadSigningStatus(deps.database, operatorId, view.rentalId, clock.now);
  if (!signing.signed) {
    return { status: "contract_unsigned" };
  }
  const rental = { ...view, id: view.rentalId };
  const problems = await loadRentalProblems(deps.database, operatorId, rental, clock);
  if (typeof problems === "string") {
    return { status: "not_found" };
  }
  const blocking = problems.filter(
    (problem) => problem.level === "handover" && problem.code !== "bond_short",
  );
  if (blocking.length > 0) {
    return { status: "blocked", problems: blocking };
  }
  const bondShort = problems.find((problem) => problem.code === "bond_short");
  if (bondShort?.code === "bond_short" && !input.bondOverrideReason) {
    return { status: "bond_short", owingCents: bondShort.owingCents };
  }
  return null;
}

/**
 * Everything the acceptance changes, in the transaction that keeps the
 * report: the checklist completed, the rental active, possession started
 * (rule 15), the car Rented and its kilometres recorded.
 */
async function recordHandedOver(
  tx: AnyTransaction,
  actor: ActingUser,
  view: HandoverView,
  accepted: { at: Date; acceptanceText: string; bondOverrideReason: string | null },
): Promise<void> {
  if (!(await lockOpenInspection(tx, actor.operatorId, view.inspectionId))) {
    throw new FinishedAlreadyError();
  }
  await tx
    .update(inspections)
    .set({
      status: "completed",
      completedAt: accepted.at,
      acceptanceText: accepted.acceptanceText,
      bondOverrideReason: accepted.bondOverrideReason,
      updatedAt: accepted.at,
    })
    .where(eq(inspections.id, view.inspectionId));
  await tx
    .update(rentals)
    .set({ status: "active", handedOverAt: accepted.at, updatedAt: accepted.at })
    .where(eq(rentals.id, view.rentalId));
  await tx.insert(possessions).values({
    operatorId: actor.operatorId,
    rentalId: view.rentalId,
    vehicleId: view.vehicleId,
    renterId: view.renterId,
    startedAt: accepted.at,
    handoverInspectionId: view.inspectionId,
  });
  await tx
    .update(vehicles)
    .set({ status: "rented", statusReason: null, statusExpectedBack: null, updatedAt: accepted.at })
    .where(eq(vehicles.id, view.vehicleId));
  await addReading(tx, actor, view.vehicleId, view.odometerKm ?? 0, {
    recordedAt: accepted.at,
    source: "handover",
  });
  await logHandedOver(tx, actor, view, accepted.bondOverrideReason !== null);
}

async function logHandedOver(
  tx: AnyTransaction,
  actor: ActingUser,
  view: HandoverView,
  isBondOverridden: boolean,
): Promise<void> {
  await recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.inspection,
    entityId: view.inspectionId,
    action: ACTIVITY_ACTIONS.accepted,
    // The override's reason stays with the checklist; the Log says only that there was one.
    valuesAfter: { status: "completed", ...(isBondOverridden ? { bondOverridden: true } : {}) },
  });
  await recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.rental,
    entityId: view.rentalId,
    action: ACTIVITY_ACTIONS.statusChanged,
    valuesBefore: { status: "booked" },
    valuesAfter: { status: "active" },
  });
  await recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.vehicle,
    entityId: view.vehicleId,
    action: ACTIVITY_ACTIONS.statusChanged,
    valuesAfter: { status: "rented" },
  });
}

/**
 * The Renter accepts the car on the Operator's phone (decision 4): checked
 * once more, the report is made with their signature and issued for good
 * (rule 12) in the same transaction that hands the car over, then emailed to
 * the Renter and the business.
 */
export async function completeHandover(
  deps: HandoverDependencies,
  actor: ActingUser,
  inspectionId: string,
  input: CompleteHandoverInput,
  clock: RentalClock,
): Promise<CompleteHandoverResult> {
  const view = await loadHandover(deps.database, actor.operatorId, inspectionId);
  // A swap's checklists are finished only with the swap.
  if (!view || view.isForSwap) {
    return { status: "not_found" };
  }
  if (view.status !== "in_progress") {
    return { status: "finished_already" };
  }
  const refusal = await acceptanceRefusal(deps, actor.operatorId, view, input, clock);
  if (refusal) {
    return refusal;
  }
  const signaturePng = decodeDrawnSignature(input.drawnSignature);
  if (!signaturePng) {
    return { status: "no_signature" };
  }
  const at = clock.now;
  const atText = formatDateTimeInTimeZone(at, clock.timeZone);
  const acceptanceText = handoverAcceptanceText({
    at,
    timeZone: clock.timeZone,
    odometerKm: view.odometerKm ?? 0,
    fuelLevel: view.fuelLevel ?? "empty",
  });
  const pdf = await renderHandoverReport(deps, actor.operatorId, view, {
    atText,
    acceptanceText,
    signaturePng,
  });
  const issued = await issueChecklistReport(deps, actor, {
    view,
    kind: "handover_report",
    pdf,
    onIssued: (tx) =>
      recordHandedOver(tx, actor, view, {
        at,
        acceptanceText,
        bondOverrideReason: input.bondOverrideReason,
      }),
  });
  if (issued.status !== "issued") {
    return { status: issued.status };
  }
  const business = await loadBusinessDetails(deps.database, actor.operatorId);
  const rentalSummary = rentalSummaryText({
    carRego: view.carRego,
    carMakeModel: view.carMakeModel,
    rentalStart: null,
  });
  await chargeRentNow(deps.database, actor.operatorId, view.rentalId);
  await emailDocumentCopies(deps, {
    kind: "handover_report",
    operatorId: actor.operatorId,
    operatorName: business?.tradingName ?? business?.legalName ?? "",
    renterEmail: view.renterEmail,
    renterName: view.renterFullName,
    rentalSummary,
    atText,
    fileName: `${HANDOVER_REPORT_TITLE} ${view.carRego}.pdf`,
    pdf,
  });
  return { status: "completed", documentId: issued.documentId };
}
