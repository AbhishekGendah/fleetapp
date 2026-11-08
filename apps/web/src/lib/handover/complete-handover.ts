import { chargeRentNow } from "../ledger/rent-job";
import {
  readRenterSignature,
  type RenterSignature,
  type RenterSignatureInput,
  formatDateTimeInTimeZone,
  handoverAcceptanceText,
  handoverBlockers,
  type BookingProblem,
  type HandoverGap,
} from "@fleetapp/core";
import type { AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  carHolds,
  inspections,
  rentals,
  renters,
  vehicles,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { EmailSender } from "@fleetapp/email";
import { and, eq, isNull } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import { emailDocumentCopies } from "../contracts/document-copies";
import { loadSigningStatus, rentalSummaryText } from "../contracts/signing-links";
import type { FileDependencies } from "../files/stored-files";
import { loadRentalProblems, type PaymentsReach } from "../rentals/booking-checks";
import {
  findBookingClash,
  heldRange,
  isCarAlreadyHeld,
  type BookingClash,
} from "../rentals/car-holds";
import type { RentalClock } from "../rentals/rental-records";
import { lockCurrentVehicle } from "../vehicles/current-vehicle";
import { addReading } from "../vehicles/odometer";
import { checklistRefusal, FinishedAlreadyError, issueChecklistReport } from "./checklist-report";
import { checklistFingerprint } from "./checklist-fingerprint";
import { lockOpenInspection } from "./handover-records";
import { startPossession } from "./possession-records";
import {
  businessAcceptanceOf,
  checklistCopyParties,
  loadHandover,
  signerNameOf,
  type HandoverView,
} from "./handover-queries";
import {
  firstReasonMissing,
  overrideLogFlags,
  reasonsStillNeeded,
  type OverrideReasons,
} from "./override-reasons";
import { signatureColumns } from "./phone-signature";
import {
  HANDOVER_REPORT_TITLE,
  isPhotoMissing,
  PHOTO_MISSING,
  renderHandoverReport,
  reportOrPhotoMissing,
} from "./handover-report";

/**
 * The handover as the phone sent it, with why the car goes anyway where a
 * check is overridden: bond short, no direct debit, no insurance or rego on
 * file (review A8-2).
 */
export interface CompleteHandoverInput extends OverrideReasons {
  /** The fingerprint of the checklist the signing screen showed (review A6-10, G9-2). */
  shownFingerprint: string;
  /** The Renter's signature on the Operator's phone, drawn or typed, as the form sent it. */
  signature: RenterSignatureInput;
}

export type CompleteHandoverResult =
  | { status: "completed"; documentId: string }
  | { status: "gaps"; gaps: HandoverGap[] }
  | { status: "blocked"; problems: BookingProblem[]; isBusinessRental: boolean }
  | { status: "bond_short"; owingCents: number; onItsWayCents: number }
  | { status: "direct_debit_missing" }
  | { status: "reason_needed"; problem: "no_insurance" | "no_rego" }
  /** Handed over early, the car would be taken from a booking before this one (review A6-3). */
  | { status: "early_clash"; clash: BookingClash | null }
  | { status: "lower"; lastKilometres: number }
  | {
      status:
        | "not_found"
        | "cancelled"
        | "contract_unsigned"
        | "no_signature"
        | "finished_already"
        | "photo_missing"
        | "changed"
        | "car_changed"
        | "renter_changed";
    };

export interface HandoverDependencies extends FileDependencies, Partial<PaymentsReach> {
  emailSender: EmailSender;
}

/** What the checks found was really skipped: only those reasons are kept (review KS-8). */
interface NeededOverrides {
  status: "accepted";
  reasons: OverrideReasons;
}

/**
 * Thrown inside the handover's transaction when, under the car's lock, it
 * can no longer go: nothing is kept.
 */
export class HandoverRefusedError extends Error {
  constructor(readonly result: Exclude<CompleteHandoverResult, { status: "completed" }>) {
    super(result.status);
  }
}

/** A car may change hands only while Available: not sold, in the workshop or out already. */
const STATUS_FOR_HANDOVER = "available";

/** Before its booked start, the car is held from now: refused if another booking has it first. */
export async function findEarlyClash(
  deps: Pick<HandoverDependencies, "database">,
  operatorId: string,
  view: HandoverView,
  now: Date,
): Promise<BookingClash | null> {
  if (now >= view.plannedStart) {
    return null;
  }
  return withTenant(deps.database, operatorId, (tx) =>
    findBookingClash(
      tx,
      operatorId,
      view.vehicleId,
      { start: now, end: view.plannedStart },
      view.rentalId,
    ),
  );
}

/**
 * What stops the Renter accepting now: anything missing from the checklist,
 * an unsigned contract, a booking or handover problem (Do not rent, car sold
 * or still out, licence: review A6-1), the kilometres below the car's last
 * reading, an early handover that would take the car from another booking, or
 * an overridable check with no reason. Otherwise, the reasons still needed.
 */
async function checkAcceptance(
  deps: HandoverDependencies,
  operatorId: string,
  view: HandoverView,
  input: CompleteHandoverInput,
  clock: RentalClock,
): Promise<CompleteHandoverResult | NeededOverrides> {
  const unfinished = checklistRefusal(view);
  if (unfinished) {
    return unfinished;
  }
  const signing = await loadSigningStatus(deps.database, operatorId, view.rentalId, clock.now);
  if (!signing.signed) {
    return { status: "contract_unsigned" };
  }
  const rental = { ...view, id: view.rentalId };
  const problems = await loadRentalProblems(
    deps.database,
    operatorId,
    rental,
    clock,
    { canHearRenterPayments: deps.canHearRenterPayments ?? false },
    true,
  );
  if (typeof problems === "string") {
    return { status: "not_found" };
  }
  const blocking = handoverBlockers(problems);
  if (blocking.length > 0) {
    return {
      status: "blocked",
      problems: blocking,
      isBusinessRental: view.renterKind === "organisation",
    };
  }
  const clash = await findEarlyClash(deps, operatorId, view, clock.now);
  if (clash) {
    return { status: "early_clash", clash };
  }
  const missing = firstReasonMissing(problems, input);
  if (missing) {
    return reasonNeededResult(missing);
  }
  return { status: "accepted", reasons: reasonsStillNeeded(problems, input) };
}

function reasonNeededResult(
  problem: NonNullable<ReturnType<typeof firstReasonMissing>>,
): CompleteHandoverResult {
  switch (problem.code) {
    case "bond_short":
      return {
        status: "bond_short",
        owingCents: problem.owingCents,
        onItsWayCents: problem.onItsWayCents,
      };
    case "direct_debit_missing":
      return { status: "direct_debit_missing" };
    case "no_insurance":
    case "no_rego":
      return { status: "reason_needed", problem: problem.code };
  }
}

/**
 * Locks the car for the handover, so a sale or another handover recorded at
 * the same moment waits and then sees it Rented (review A8-4); refused unless
 * it is still Available.
 */
async function lockCarForHandover(
  tx: AnyTransaction,
  operatorId: string,
  vehicleId: string,
): Promise<void> {
  const car = await lockCurrentVehicle(tx, operatorId, vehicleId);
  if (car?.status !== STATUS_FOR_HANDOVER) {
    throw new HandoverRefusedError({ status: "car_changed" });
  }
}

/**
 * Why the checklist is no longer open: cancelled (with its booking, say)
 * is said plainly; otherwise it was finished on another phone.
 */
async function notOpenError(
  tx: AnyTransaction,
  operatorId: string,
  inspectionId: string,
): Promise<Error> {
  const [checklist] = await tx
    .select({ status: inspections.status })
    .from(inspections)
    .where(and(eq(inspections.id, inspectionId), eq(inspections.operatorId, operatorId)));
  return checklist?.status === "cancelled"
    ? new HandoverRefusedError({ status: "cancelled" })
    : new FinishedAlreadyError();
}

/** One Renter locked for the handover and checked once more: false if marked Do not rent or archived since. */
async function isRenterStillActive(
  tx: AnyTransaction,
  operatorId: string,
  renterId: string,
): Promise<boolean> {
  const [renter] = await tx
    .select({ status: renters.status })
    .from(renters)
    .where(
      and(eq(renters.id, renterId), eq(renters.operatorId, operatorId), isNull(renters.archivedAt)),
    )
    .for("update");
  return renter?.status === "active";
}

/** The rental's driver now, read again under the rental's lock (held since the report was numbered). */
async function lockRentalDriver(
  tx: AnyTransaction,
  operatorId: string,
  rentalId: string,
): Promise<string | null | undefined> {
  const [rental] = await tx
    .select({ driverId: rentals.driverId })
    .from(rentals)
    .where(and(eq(rentals.id, rentalId), eq(rentals.operatorId, operatorId)))
    .for("update");
  return rental?.driverId;
}

/**
 * The Renter, then the driver (the same person for a person's own rental),
 * locked for the handover and checked once more, then the rental's driver
 * read again: marked Do not rent or archived since the checks above, the
 * car stays (review A6-1, slice 1 review F5); the rental now naming another
 * driver than the one the signing screen showed, it stays as changed (slice
 * 3 review). Gives who the car goes to. A business's car never goes before
 * its driver is named. The rental is already locked (its report is numbered
 * under that lock), then the checklist and the car: the order every change
 * to a rental takes (docs/plans/business-renters.md, "Lock order"), so
 * naming a driver or cancelling at the same moment waits, never deadlocks.
 */
export async function lockPartiesForHandover(
  tx: AnyTransaction,
  operatorId: string,
  view: Pick<HandoverView, "rentalId" | "renterId" | "driverId">,
): Promise<string> {
  const { renterId, driverId } = view;
  if (driverId === null) {
    // Said as the checks before say it, never as a Renter marked Do not rent: a
    // checklist started before naming was required can still get here.
    throw new HandoverRefusedError({
      status: "blocked",
      problems: [{ code: "driver_not_named", level: "handover" }],
      isBusinessRental: true,
    });
  }
  if (
    !(await isRenterStillActive(tx, operatorId, renterId)) ||
    (driverId !== renterId && !(await isRenterStillActive(tx, operatorId, driverId)))
  ) {
    throw new HandoverRefusedError({ status: "renter_changed" });
  }
  if ((await lockRentalDriver(tx, operatorId, view.rentalId)) !== driverId) {
    throw new HandoverRefusedError({ status: "changed" });
  }
  return driverId;
}

/**
 * Handed over before its booked start, the rental holds the car from now, so
 * the time before can't be booked by someone else (review A6-3).
 */
async function holdCarFromNow(
  tx: AnyTransaction,
  actor: ActingUser,
  view: HandoverView,
  at: Date,
): Promise<void> {
  if (at >= view.plannedStart) {
    return;
  }
  const clash = await findBookingClash(
    tx,
    actor.operatorId,
    view.vehicleId,
    { start: at, end: view.plannedStart },
    view.rentalId,
  );
  if (clash) {
    throw new HandoverRefusedError({ status: "early_clash", clash });
  }
  // In a savepoint: a booking made at the same moment is refused by the database, said plainly.
  const moved = await tx
    .transaction((savepoint) =>
      savepoint
        .update(carHolds)
        .set({ heldDuring: heldRange(at, view.plannedEnd) })
        .where(
          and(
            eq(carHolds.operatorId, actor.operatorId),
            eq(carHolds.rentalId, view.rentalId),
            eq(carHolds.vehicleId, view.vehicleId),
            isNull(carHolds.releasedAt),
          ),
        )
        .returning({ id: carHolds.id }),
    )
    .catch((error: unknown) => {
      if (isCarAlreadyHeld(error)) {
        throw new HandoverRefusedError({ status: "early_clash", clash: null });
      }
      throw error;
    });
  for (const hold of moved) {
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.carHold,
      entityId: hold.id,
      action: ACTIVITY_ACTIONS.updated,
      valuesBefore: { startedAt: view.plannedStart.toISOString() },
      valuesAfter: { startedAt: at.toISOString() },
    });
  }
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
  accepted: {
    at: Date;
    acceptanceText: string;
    signature: RenterSignature;
    reasons: OverrideReasons;
  },
): Promise<void> {
  if (!(await lockOpenInspection(tx, actor.operatorId, view.inspectionId))) {
    throw await notOpenError(tx, actor.operatorId, view.inspectionId);
  }
  await lockCarForHandover(tx, actor.operatorId, view.vehicleId);
  const driverId = await lockPartiesForHandover(tx, actor.operatorId, view);
  await holdCarFromNow(tx, actor, view, accepted.at);
  await tx
    .update(inspections)
    .set({
      status: "completed",
      completedAt: accepted.at,
      acceptanceText: accepted.acceptanceText,
      ...signatureColumns(accepted.signature),
      ...accepted.reasons,
      updatedAt: accepted.at,
    })
    .where(eq(inspections.id, view.inspectionId));
  // Only a booking still going ahead (a cancelled one is never made active).
  const [madeActive] = await tx
    .update(rentals)
    .set({ status: "active", handedOverAt: accepted.at, updatedAt: accepted.at })
    .where(and(eq(rentals.id, view.rentalId), eq(rentals.status, "booked")))
    .returning({ id: rentals.id });
  if (!madeActive) {
    throw new HandoverRefusedError({ status: "cancelled" });
  }
  await startPossession(
    tx,
    actor,
    {
      rentalId: view.rentalId,
      vehicleId: view.vehicleId,
      renterId: view.renterId,
      driverId,
      startedAt: accepted.at,
      handoverInspectionId: view.inspectionId,
    },
    view.carRego,
  );
  await tx
    .update(vehicles)
    .set({ status: "rented", statusReason: null, statusExpectedBack: null, updatedAt: accepted.at })
    .where(eq(vehicles.id, view.vehicleId));
  await addReading(tx, actor, view.vehicleId, view.odometerKm ?? 0, {
    recordedAt: accepted.at,
    source: "handover",
  });
  await logHandedOver(tx, actor, view, accepted.reasons);
}

async function logHandedOver(
  tx: AnyTransaction,
  actor: ActingUser,
  view: HandoverView,
  reasons: OverrideReasons,
): Promise<void> {
  await recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.inspection,
    entityId: view.inspectionId,
    action: ACTIVITY_ACTIONS.accepted,
    // The override's reason stays with the checklist; the Log says only that there was one.
    valuesAfter: { status: "completed", ...overrideLogFlags(reasons) },
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

/** Issues the report and hands the car over together; a refusal under the car's lock keeps nothing. */
async function issueHandoverReport(
  deps: HandoverDependencies,
  actor: ActingUser,
  view: HandoverView,
  accepted: Parameters<typeof recordHandedOver>[3] & { pdf: Uint8Array },
): Promise<
  | { status: "issued"; documentId: string }
  | Exclude<CompleteHandoverResult, { status: "completed" }>
> {
  try {
    const issued = await issueChecklistReport(deps, actor, {
      view,
      kind: "handover_report",
      pdf: accepted.pdf,
      onIssued: (tx) => recordHandedOver(tx, actor, view, accepted),
    });
    return issued.status === "issued" ? issued : { status: issued.status };
  } catch (error) {
    if (error instanceof HandoverRefusedError) {
      return error.result;
    }
    throw error;
  }
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
  if (view.status === "cancelled") {
    return { status: "cancelled" };
  }
  if (view.status !== "in_progress") {
    return { status: "finished_already" };
  }
  if (checklistFingerprint(view) !== input.shownFingerprint) {
    return { status: "changed" };
  }
  const checked = await checkAcceptance(deps, actor.operatorId, view, input, clock);
  if (checked.status !== "accepted") {
    return checked;
  }
  // The driver signs for a business's car (rule 15); for a person, the Renter.
  const signature = readRenterSignature(input.signature, signerNameOf(view) ?? "");
  if (!signature) {
    return { status: "no_signature" };
  }
  const at = clock.now;
  const atText = formatDateTimeInTimeZone(at, clock.timeZone);
  const acceptanceText = handoverAcceptanceText({
    at,
    timeZone: clock.timeZone,
    odometerKm: view.odometerKm ?? 0,
    fuelLevel: view.fuelLevel ?? "empty",
    forBusiness: businessAcceptanceOf(view),
  });
  const pdf = await reportOrPhotoMissing(() =>
    renderHandoverReport(deps, actor.operatorId, view, { atText, acceptanceText, signature }),
  );
  if (isPhotoMissing(pdf)) {
    return PHOTO_MISSING;
  }
  const issued = await issueHandoverReport(deps, actor, view, {
    at,
    acceptanceText,
    signature,
    reasons: checked.reasons,
    pdf,
  });
  if (issued.status !== "issued") {
    return issued;
  }
  const rentalSummary = rentalSummaryText({
    carRego: view.carRego,
    carMakeModel: view.carMakeModel,
    rentalStart: null,
  });
  // Neither step below throws: the car is handed over for good now (review G9-9).
  await chargeRentNow(deps, actor.operatorId, view.rentalId);
  await emailDocumentCopies(deps, {
    documentId: issued.documentId,
    kind: "handover_report",
    operatorId: actor.operatorId,
    ...checklistCopyParties(view),
    rentalSummary,
    atText,
    fileName: `${HANDOVER_REPORT_TITLE} ${view.carRego}.pdf`,
    pdf,
  });
  return { status: "completed", documentId: issued.documentId };
}
