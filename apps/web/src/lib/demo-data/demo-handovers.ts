import { CAR_AREAS, FUEL_LEVELS } from "@fleetapp/core";

import { loadSigningStatus } from "../contracts/signing-links";
import { completeHandover } from "../handover/complete-handover";
import { startChecklistPhotoUpload, type ChecklistPhotoTarget } from "../handover/handover-photos";
import { loadHandover, type HandoverView } from "../handover/handover-queries";
import { addDamageMark, saveHandoverDetails, startHandover } from "../handover/handover-records";
import { dayFrom, expectSaved, type DemoContext, DemoDataError } from "./demo-context";
import { pictureFrom, plannedSizeOf, sendDemoPhoto } from "./demo-files";
import { DEMO_PICTURES, DEMO_SIGNATURE } from "./demo-pictures";
import { DEMO_RENTALS, type DemoRentalPlan } from "./demo-plan";
import { bookingClock, findRental, issueDemoContract, momentOf } from "./demo-rentals";

/** The demo picture that best fits a checklist photo's name. */
function pictureForPhoto(photoName: string): string {
  const name = photoName.toLowerCase();
  if (name.includes("dashboard") || name.includes("kilometre")) {
    return DEMO_PICTURES.dashboard;
  }
  if (name.includes("interior")) {
    return DEMO_PICTURES.interior;
  }
  if (name.includes("boot")) {
    return DEMO_PICTURES.boot;
  }
  if (name.includes("front") || name.includes("rear")) {
    return DEMO_PICTURES.front;
  }
  return DEMO_PICTURES.side;
}

async function takeDemoPhoto(
  context: DemoContext,
  inspectionId: string,
  target: ChecklistPhotoTarget,
  base64: string,
): Promise<void> {
  const picture = pictureFrom(base64);
  const start = await startChecklistPhotoUpload(
    context.deps,
    context.actor,
    inspectionId,
    target,
    { photo: plannedSizeOf(picture), thumbnail: plannedSizeOf(picture) },
    context.timeZone,
  );
  await sendDemoPhoto(context, start, picture);
}

export async function photographEverything(
  context: DemoContext,
  view: HandoverView,
): Promise<void> {
  for (const photoName of view.photoNames) {
    if (!view.photos.has(photoName)) {
      await takeDemoPhoto(context, view.inspectionId, { photoName }, pictureForPhoto(photoName));
    }
  }
}

/** Damage on the car, each placed on an area of the outline and photographed. */
export async function markDemoDamage(
  context: DemoContext,
  view: HandoverView,
  damage: { carNumber: number; descriptions: readonly string[] },
): Promise<void> {
  if (view.damageMarks.length > 0) {
    return;
  }
  const plan = { carNumber: damage.carNumber };
  for (const [index, description] of damage.descriptions.entries()) {
    const area = CAR_AREAS[(plan.carNumber + index * 3) % CAR_AREAS.length]!;
    const added = await addDamageMark(context.deps.database, context.actor, view.inspectionId, {
      x: area.x,
      y: area.y,
      description,
    });
    if (added.status !== "added") {
      throw new DemoDataError(`A demo damage mark was not saved: ${added.status}`);
    }
    await takeDemoPhoto(
      context,
      view.inspectionId,
      { damageMarkId: added.markId },
      DEMO_PICTURES.damage,
    );
  }
}

const KILOMETRES_DRIVEN_TO_HANDOVER = 120;
const ACCESSORIES = ["Phone holder and charging cable", null, "Child seat", null];

export async function fillDemoDetails(
  context: DemoContext,
  view: HandoverView,
  plan: Pick<DemoRentalPlan, "carNumber" | "code">,
  kilometresDriven = KILOMETRES_DRIVEN_TO_HANDOVER,
): Promise<void> {
  const saved = await saveHandoverDetails(context.deps.database, context.actor, view.inspectionId, {
    fuelLevel: FUEL_LEVELS[plan.carNumber % FUEL_LEVELS.length]!,
    keysCount: plan.carNumber % 3 === 0 ? 1 : 2,
    accessories: ACCESSORIES[plan.carNumber % ACCESSORIES.length] ?? null,
    notes: plan.carNumber % 4 === 0 ? "Car washed and vacuumed before handover." : null,
    odometerKm: (view.lastKilometres ?? 0) + kilometresDriven,
  });
  expectSaved(saved.status, ["saved"], `checklist details for ${plan.code}`);
}

async function loadDemoHandover(context: DemoContext, inspectionId: string): Promise<HandoverView> {
  const view = await loadHandover(context.deps.database, context.actor.operatorId, inspectionId);
  if (!view) {
    throw new DemoDataError("The demo handover checklist was not found.");
  }
  return view;
}

/** Before the handover the Renter signs; for demo data, a contract marked as such. */
async function ensureDemoContract(context: DemoContext, rentalId: string, plan: DemoRentalPlan) {
  const signing = await loadSigningStatus(
    context.deps.database,
    context.actor.operatorId,
    rentalId,
    new Date(),
  );
  if (!signing.signed) {
    await issueDemoContract(context, rentalId, bookingClock(context, plan));
  }
}

const HANDOVER_MINUTES_AFTER_START = "10:30";

/**
 * Hands one demo rental's car over on its start day, as the checklist on
 * the Operator's phone does: every photo, any damage, the details, then
 * the Renter's acceptance with a drawn signature. The report is issued and
 * emailed (to the test inbox). One already handed over is left alone.
 */
export async function handOverDemoRental(
  context: DemoContext,
  code: string,
): Promise<"added" | "there"> {
  const plan = DEMO_RENTALS.find((rental) => rental.code === code);
  const rental = await findRental(context, code);
  if (!plan || !rental) {
    throw new DemoDataError(`Demo rental ${code} needs booking first.`);
  }
  if (rental.status !== "booked") {
    return "there";
  }
  await ensureDemoContract(context, rental.id, plan);
  const started = await startHandover(context.deps.database, context.actor, rental.id);
  if (started.status !== "started" && started.status !== "resumed") {
    throw new DemoDataError(`The demo handover for ${code} did not start: ${started.status}`);
  }
  await photographEverything(context, await loadDemoHandover(context, started.inspectionId));
  await markDemoDamage(context, await loadDemoHandover(context, started.inspectionId), {
    carNumber: plan.carNumber,
    descriptions: plan.damage ?? [],
  });
  await fillDemoDetails(context, await loadDemoHandover(context, started.inspectionId), plan);
  const handedOverAt = momentOf(
    context,
    dayFrom(context, plan.startDays),
    HANDOVER_MINUTES_AFTER_START,
  );
  const result = await completeHandover(
    context.deps,
    context.actor,
    started.inspectionId,
    { drawnSignature: DEMO_SIGNATURE, bondOverrideReason: plan.bondOverrideReason ?? null },
    { timeZone: context.timeZone, now: handedOverAt },
  );
  expectSaved(result.status, ["completed"], `handover for ${code}`);
  return "added";
}
