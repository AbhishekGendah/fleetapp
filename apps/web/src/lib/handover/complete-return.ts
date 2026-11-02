import {
  decodeDrawnSignature,
  formatDateTimeInTimeZone,
  operatorSettingsSchema,
  readSettings,
  renterAbsentText,
  returnAcceptanceText,
  recordedReturnTime,
  type HandoverGap,
  type ReturnTimeProblem,
  todayInTimeZone,
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
import { and, eq, isNull } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import { emailDocumentCopies } from "../contracts/document-copies";
import { recordDamageFromReturn } from "../damage/damage-records";
import { rentalSummaryText } from "../contracts/signing-links";
import { releaseCarHolds } from "../rentals/car-holds";
import type { RentalClock } from "../rentals/rental-records";
import { loadBusinessDetails } from "../settings/business-details";
import type { VehicleStatusInput } from "../vehicles/vehicle-input";
import { addReading } from "../vehicles/odometer";
import type { HandoverDependencies } from "./complete-handover";
import { checklistRefusal, FinishedAlreadyError, issueChecklistReport } from "./checklist-report";
import { lockOpenInspection } from "./handover-records";
import { loadCompletedHandover, loadReturn, type HandoverView } from "./handover-queries";
import { RETURN_REPORT_TITLE, renderReturnReport } from "./return-report";

/** Where a returned car may go: back for rent, or off for repair. Never Sold from here. */
const STATUSES_AFTER_RETURN: readonly VehicleStatusInput["status"][] = [
  "available",
  "in_service",
  "off_road",
];

export interface CompleteReturnInput {
  /** When the car came back: now, or the real time of an after-hours drop-off. */
  returnedAt: Date;
  /** The Renter's drawn signature; null when they were not there. */
  drawnSignature: string | null;
  /** The car's status from now on. */
  carAfter: VehicleStatusInput;
}

export type CompleteReturnResult =
  | { status: "completed"; documentId: string }
  | { status: "gaps"; gaps: HandoverGap[] }
  | { status: "lower"; lastKilometres: number }
  | { status: "return_time"; problem: ReturnTimeProblem }
  | {
      status:
        "not_found" | "finished_already" | "no_signature" | "signature_required" | "car_status";
    };

/** What stops the return being finished now. */
function returnRefusal(
  view: HandoverView,
  input: CompleteReturnInput,
  clock: RentalClock,
): CompleteReturnResult | null {
  const unfinished = checklistRefusal(view);
  if (unfinished) {
    return unfinished;
  }
  const settings = readSettings(operatorSettingsSchema, view.settingsSnapshot);
  if (input.drawnSignature === null && settings.isRenterSignatureAtReturnRequired) {
    return { status: "signature_required" };
  }
  return STATUSES_AFTER_RETURN.includes(input.carAfter.status) ? null : { status: "car_status" };
}

interface Returned {
  at: Date;
  acceptanceText: string;
  isRenterAbsent: boolean;
  carAfter: VehicleStatusInput;
  /** The return's day on the business's calendar: when its new damage was found. */
  foundOn: string;
}

/**
 * Everything the return changes, in the transaction that keeps the report:
 * the checklist completed, possession ended at the return time (rule 15),
 * the rental returned, the car's hold released from then, its status and
 * kilometres recorded.
 */
async function recordReturned(
  tx: AnyTransaction,
  actor: ActingUser,
  view: HandoverView,
  returned: Returned,
): Promise<void> {
  if (!(await lockOpenInspection(tx, actor.operatorId, view.inspectionId))) {
    throw new FinishedAlreadyError();
  }
  const now = new Date();
  await tx
    .update(inspections)
    .set({
      status: "completed",
      completedAt: now,
      acceptanceText: returned.acceptanceText,
      isRenterAbsent: returned.isRenterAbsent,
      updatedAt: now,
    })
    .where(eq(inspections.id, view.inspectionId));
  await tx
    .update(possessions)
    .set({ endedAt: returned.at, returnInspectionId: view.inspectionId, updatedAt: now })
    .where(
      and(
        eq(possessions.operatorId, actor.operatorId),
        eq(possessions.rentalId, view.rentalId),
        isNull(possessions.endedAt),
      ),
    );
  await tx
    .update(rentals)
    .set({ status: "returned", returnedAt: returned.at, updatedAt: now })
    .where(eq(rentals.id, view.rentalId));
  await releaseCarHolds(tx, actor.operatorId, view.rentalId, returned.at);
  await tx
    .update(vehicles)
    .set({ ...returned.carAfter, updatedAt: now })
    .where(eq(vehicles.id, view.vehicleId));
  await addReading(tx, actor, view.vehicleId, view.odometerKm ?? 0, {
    recordedAt: returned.at,
    source: "return",
  });
  await recordDamageFromReturn(tx, actor, {
    inspectionId: view.inspectionId,
    rentalId: view.rentalId,
    vehicleId: view.vehicleId,
    renterId: view.renterId,
    foundOn: returned.foundOn,
  });
  await logReturned(tx, actor, view, returned);
}

async function logReturned(
  tx: AnyTransaction,
  actor: ActingUser,
  view: HandoverView,
  returned: Returned,
): Promise<void> {
  await recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.inspection,
    entityId: view.inspectionId,
    action: ACTIVITY_ACTIONS.accepted,
    valuesAfter: { status: "completed", isRenterAbsent: returned.isRenterAbsent },
  });
  // The return time is in the Log as entered, so an after-hours time typed in later shows who and when.
  await recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.rental,
    entityId: view.rentalId,
    action: ACTIVITY_ACTIONS.statusChanged,
    valuesBefore: { status: "active" },
    valuesAfter: { status: "returned", returnedAt: returned.at.toISOString() },
  });
  await recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.vehicle,
    entityId: view.vehicleId,
    action: ACTIVITY_ACTIONS.statusChanged,
    valuesAfter: { status: returned.carAfter.status },
  });
}

async function emailReturnReport(
  deps: HandoverDependencies,
  actor: ActingUser,
  view: HandoverView,
  report: { atText: string; pdf: Uint8Array },
): Promise<void> {
  const business = await loadBusinessDetails(deps.database, actor.operatorId);
  await emailDocumentCopies(deps, {
    kind: "return_report",
    operatorId: actor.operatorId,
    operatorName: business?.tradingName ?? business?.legalName ?? "",
    renterEmail: view.renterEmail,
    renterName: view.renterFullName,
    rentalSummary: rentalSummaryText({
      carRego: view.carRego,
      carMakeModel: view.carMakeModel,
      rentalStart: null,
    }),
    atText: report.atText,
    fileName: `${RETURN_REPORT_TITLE} ${view.carRego}.pdf`,
    pdf: report.pdf,
  });
}

/**
 * The car comes back (docs/plans/phase-3-slice-6.md): checked once more,
 * the return report is made (the handover's photos beside the return's,
 * signed by the Renter if they are there) and issued for good (rule 12) in
 * the same transaction that ends possession and frees the car, then emailed.
 */
export async function completeReturn(
  deps: HandoverDependencies,
  actor: ActingUser,
  inspectionId: string,
  requested: CompleteReturnInput,
  clock: RentalClock,
): Promise<CompleteReturnResult> {
  const view = await loadReturn(deps.database, actor.operatorId, inspectionId);
  if (!view || view.status !== "in_progress") {
    return { status: view ? "finished_already" : "not_found" };
  }
  if (!view.handedOverAt) {
    return { status: "not_found" };
  }
  const recorded = recordedReturnTime(requested.returnedAt, {
    handedOverAt: view.handedOverAt,
    now: clock.now,
    timeZone: clock.timeZone,
  });
  if ("problem" in recorded) {
    return { status: "return_time", problem: recorded.problem };
  }
  const input = { ...requested, returnedAt: recorded.at };
  const handover = await loadCompletedHandover(deps.database, actor.operatorId, view.rentalId);
  const refusal = handover ? returnRefusal(view, input, clock) : { status: "not_found" as const };
  if (refusal || !handover) {
    return refusal ?? { status: "not_found" };
  }
  const signaturePng =
    input.drawnSignature === null ? null : decodeDrawnSignature(input.drawnSignature);
  if (input.drawnSignature !== null && !signaturePng) {
    return { status: "no_signature" };
  }
  const facts = { at: input.returnedAt, timeZone: clock.timeZone };
  const acceptanceText = signaturePng
    ? returnAcceptanceText({
        ...facts,
        odometerKm: view.odometerKm ?? 0,
        fuelLevel: view.fuelLevel ?? "empty",
      })
    : renterAbsentText(facts);
  const atText = formatDateTimeInTimeZone(input.returnedAt, clock.timeZone);
  const pdf = await renderReturnReport(deps, actor.operatorId, view, {
    handover,
    returnedAtText: atText,
    acceptanceText,
    signaturePng,
  });
  const issued = await issueChecklistReport(deps, actor, {
    view,
    kind: "return_report",
    pdf,
    onIssued: (tx) =>
      recordReturned(tx, actor, view, {
        at: input.returnedAt,
        acceptanceText,
        isRenterAbsent: signaturePng === null,
        carAfter: input.carAfter,
        foundOn: todayInTimeZone(input.returnedAt, clock.timeZone),
      }),
  });
  if (issued.status !== "issued") {
    return { status: issued.status };
  }
  await emailReturnReport(deps, actor, view, { atText, pdf });
  return { status: "completed", documentId: issued.documentId };
}
