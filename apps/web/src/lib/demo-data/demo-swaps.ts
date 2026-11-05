import { drawnSignatureInput } from "@fleetapp/core";
import type { TemplateDocument } from "@fleetapp/core";

import { completeSwap } from "../handover/complete-swap";
import { loadHandover, loadReturn, type HandoverView } from "../handover/handover-queries";
import { listRentalSwaps, startSwap } from "../rentals/car-swaps";
import { findCarId, demoCar } from "./demo-cars";
import { ensureDemoTemplate } from "./demo-changes";
import { dayFrom, DemoDataError, expectSaved, type DemoContext } from "./demo-context";
import { fillDemoDetails, photographEverything } from "./demo-handovers";
import { DEMO_SIGNATURE } from "./demo-pictures";
import { DEMO_RENTALS } from "./demo-plan";
import { findRental } from "./demo-rentals";

const DEMO_SWAP_TEMPLATE_NAME = "Demo car swap form";
/** R04 (ongoing) swaps out of car 4 into car 37, an idle car with no bookings. */
const SWAPPED_RENTAL = "R04";
const NEW_CAR_NUMBER = 37;
const SWAP_REASON = "Engine light on";
/** What the Renter drove since the handover, before the car came back. */
const KILOMETRES_DRIVEN_BEFORE_SWAP = 1_150;
/** The new car leaves the yard straight away. */
const KILOMETRES_TO_NEW_CAR = 0;
/** The old car is expected back from the workshop this many days on. */
const WORKSHOP_DAYS = 5;

/** A short swap form that uses only what every demo rental has on file. */
const DEMO_SWAP_FORM: TemplateDocument = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Car swap" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Demo data: made up for testing. " },
        { type: "mergeField", attrs: { key: "renterFullName" } },
        { type: "text", text: " hands back " },
        { type: "mergeField", attrs: { key: "swapOldCar" } },
        { type: "text", text: " and takes " },
        { type: "mergeField", attrs: { key: "swapNewCar" } },
        { type: "text", text: ". Why: " },
        { type: "mergeField", attrs: { key: "swapReason" } },
      ],
    },
  ],
};

async function loadDemoView(
  context: DemoContext,
  load: typeof loadHandover,
  inspectionId: string,
): Promise<HandoverView> {
  const view = await load(context.deps.database, context.actor.operatorId, inspectionId);
  if (!view) {
    throw new DemoDataError("A demo swap checklist was not found.");
  }
  return view;
}

/**
 * A car swap for the demo: one ongoing rental's car checked in with the
 * Engine light on, an idle car checked out with every photo, and the
 * Renter's signature, so three documents are issued (to the test inbox).
 * The old car goes to the workshop. A rental already swapped is left alone.
 */
export async function addDemoSwap(context: DemoContext): Promise<number> {
  const plan = DEMO_RENTALS.find((rental) => rental.code === SWAPPED_RENTAL)!;
  const rental = await findRental(context, SWAPPED_RENTAL);
  const newCarId = await findCarId(context, demoCar(NEW_CAR_NUMBER).rego);
  if (!rental || rental.status !== "active" || !newCarId) {
    throw new DemoDataError(`Demo rental ${SWAPPED_RENTAL} needs handing over first.`);
  }
  const swaps = await listRentalSwaps(context.deps.database, context.actor.operatorId, rental.id);
  if (swaps.some((swap) => swap.status === "completed")) {
    return 0;
  }
  await ensureDemoTemplate(context, {
    kind: "swap_form",
    name: DEMO_SWAP_TEMPLATE_NAME,
    content: DEMO_SWAP_FORM,
  });
  const clock = { timeZone: context.timeZone, now: new Date() };
  const started = await startSwap(
    context.deps.database,
    context.actor,
    rental.id,
    { toVehicleId: newCarId, reason: SWAP_REASON },
    clock,
  );
  if (!("swapId" in started)) {
    throw new DemoDataError(`The demo swap did not start: ${started.status}`);
  }
  const [swap] = (
    await listRentalSwaps(context.deps.database, context.actor.operatorId, rental.id)
  ).filter((candidate) => candidate.id === started.swapId);
  const oldCar = await loadDemoView(context, loadReturn, swap!.returnInspectionId);
  await photographEverything(context, oldCar);
  await fillDemoDetails(context, oldCar, plan, KILOMETRES_DRIVEN_BEFORE_SWAP);
  const newCar = await loadDemoView(context, loadHandover, swap!.handoverInspectionId);
  await photographEverything(context, newCar);
  await fillDemoDetails(
    context,
    newCar,
    { carNumber: NEW_CAR_NUMBER, code: SWAPPED_RENTAL },
    KILOMETRES_TO_NEW_CAR,
  );
  const result = await completeSwap(
    context.deps,
    context.actor,
    rental.id,
    {
      signature: drawnSignatureInput(DEMO_SIGNATURE),
      oldCarAfter: {
        status: "in_service",
        statusReason: "Engine light: diagnosis",
        statusExpectedBack: dayFrom(context, WORKSHOP_DAYS),
      },
    },
    clock,
  );
  expectSaved(result.status, ["completed"], `car swap for ${SWAPPED_RENTAL}`);
  return 1;
}
