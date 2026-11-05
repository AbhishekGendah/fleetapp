import { chargeRentNow } from "../ledger/rent-job";
import {
  readRenterSignature,
  type RenterSignature,
  type RenterSignatureInput,
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
  rentals,
  vehicles,
} from "@fleetapp/db/schema";
import { eq } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import { emailDocumentCopies } from "../contracts/document-copies";
import { recordDamageFromReturn } from "../damage/damage-records";
import { rentalSummaryText } from "../contracts/signing-links";
import { releaseCarHolds } from "../rentals/car-holds";
import type { RentalClock } from "../rentals/rental-records";
import type { VehicleStatusInput } from "../vehicles/vehicle-input";
import { addReading } from "../vehicles/odometer";
import type { HandoverDependencies } from "./complete-handover";
import { checklistRefusal, FinishedAlreadyError, issueChecklistReport } from "./checklist-report";
import { lockOpenInspection } from "./handover-records";
import { loadCompletedHandover, loadReturn, type HandoverView } from "./handover-queries";
import { checklistFingerprint } from "./checklist-fingerprint";
import { isPhotoMissing, PHOTO_MISSING, reportOrPhotoMissing } from "./handover-report";
import { signatureColumns } from "./phone-signature";
import { endPossession } from "./possession-records";
import { RETURN_REPORT_TITLE, renderReturnReport } from "./return-report";

/** Where a returned car may go: back for rent, or off for repair. Never Sold from here. */
const STATUSES_AFTER_RETURN: readonly VehicleStatusInput["status"][] = [
  "available",
  "in_service",
  "off_road",
];

export interface CompleteReturnInput {
  /** The fingerprint of the checklist the signing screen showed (review A6-10, G9-2). */
  shownFingerprint: string;
  /** When the car came back: now, or the real time of an after-hours drop-off. */
  returnedAt: Date;
  /** The Renter's signature, drawn or typed; null when they were not there. */
  signature: RenterSignatureInput | null;
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
        | "not_found"
        | "finished_already"
        | "no_signature"
        | "signature_required"
        | "car_status"
        | "photo_missing"
        | "changed";
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
  if (input.signature === null && settings.isRenterSignatureAtReturnRequired) {
    return { status: "signature_required" };
  }
  return STATUSES_AFTER_RETURN.includes(input.carAfter.status) ? null : { status: "car_status" };
}

interface Returned {
  at: Date;
  acceptanceText: string;
  signature: RenterSignature | null;
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
      ...signatureColumns(returned.signature),
      isRenterAbsent: returned.isRenterAbsent,
      updatedAt: now,
    })
    .where(eq(inspections.id, view.inspectionId));
  await endPossession(tx, actor, {
    rentalId: view.rentalId,
    endedAt: returned.at,
    returnInspectionId: view.inspectionId,
  });
  await tx
    .update(rentals)
    .set({ status: "returned", returnedAt: returned.at, updatedAt: now })
    .where(eq(rentals.id, view.rentalId));
  await releaseCarHolds(tx, actor, view.rentalId, returned.at);
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
  report: { documentId: string; atText: string; pdf: Uint8Array },
): Promise<void> {
  await emailDocumentCopies(deps, {
    documentId: report.documentId,
    kind: "return_report",
    operatorId: actor.operatorId,
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
  // A swap's checklists are finished only with the swap.
  if (!view || view.isForSwap) {
    return { status: "not_found" };
  }
  if (view.status !== "in_progress") {
    return { status: "finished_already" };
  }
  if (!view.handedOverAt) {
    return { status: "not_found" };
  }
  if (checklistFingerprint(view) !== requested.shownFingerprint) {
    return { status: "changed" };
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
  const handover = await loadCompletedHandover(deps.database, actor.operatorId, {
    rentalId: view.rentalId,
    vehicleId: view.vehicleId,
  });
  const refusal = handover ? returnRefusal(view, input, clock) : { status: "not_found" as const };
  if (refusal || !handover) {
    return refusal ?? { status: "not_found" };
  }
  const signature =
    input.signature === null ? null : readRenterSignature(input.signature, view.renterFullName);
  if (input.signature !== null && !signature) {
    return { status: "no_signature" };
  }
  const facts = { at: input.returnedAt, timeZone: clock.timeZone };
  const acceptanceText = signature
    ? returnAcceptanceText({
        ...facts,
        odometerKm: view.odometerKm ?? 0,
        fuelLevel: view.fuelLevel ?? "empty",
      })
    : renterAbsentText(facts);
  const atText = formatDateTimeInTimeZone(input.returnedAt, clock.timeZone);
  const pdf = await reportOrPhotoMissing(() =>
    renderReturnReport(deps, actor.operatorId, view, {
      handover,
      returnedAtText: atText,
      acceptanceText,
      signature,
      signedAtText: formatDateTimeInTimeZone(clock.now, clock.timeZone),
    }),
  );
  if (isPhotoMissing(pdf)) {
    return PHOTO_MISSING;
  }
  const issued = await issueChecklistReport(deps, actor, {
    view,
    kind: "return_report",
    pdf,
    onIssued: (tx) =>
      recordReturned(tx, actor, view, {
        at: input.returnedAt,
        acceptanceText,
        signature,
        isRenterAbsent: signature === null,
        carAfter: input.carAfter,
        foundOn: todayInTimeZone(input.returnedAt, clock.timeZone),
      }),
  });
  if (issued.status !== "issued") {
    return { status: issued.status };
  }
  await chargeRentNow(deps, actor.operatorId, view.rentalId);
  await emailReturnReport(deps, actor, view, { documentId: issued.documentId, atText, pdf });
  return { status: "completed", documentId: issued.documentId };
}
