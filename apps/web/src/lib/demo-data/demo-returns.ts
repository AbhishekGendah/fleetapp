import { drawnSignatureInput } from "@fleetapp/core";
import { checklistFingerprint } from "../handover/checklist-fingerprint";
import { completeReturn } from "../handover/complete-return";
import { loadReturn, type HandoverView } from "../handover/handover-queries";
import { startReturn } from "../handover/handover-records";
import { dayFrom, DemoDataError, expectSaved, type DemoContext } from "./demo-context";
import { fillDemoDetails, markDemoDamage, photographEverything } from "./demo-handovers";
import { DEMO_SIGNATURE } from "./demo-pictures";
import { DEMO_RENTALS, type DemoReturnPlan } from "./demo-plan";
import { findRental, momentOf } from "./demo-rentals";

/** About what a weekly rideshare car covers in a few weeks. */
const KILOMETRES_DRIVEN_ON_RENTAL = 1_480;

async function loadDemoReturn(context: DemoContext, inspectionId: string): Promise<HandoverView> {
  const view = await loadReturn(context.deps.database, context.actor.operatorId, inspectionId);
  if (!view) {
    throw new DemoDataError("The demo return checklist was not found.");
  }
  return view;
}

function carAfter(context: DemoContext, returned: DemoReturnPlan) {
  return returned.toWorkshop
    ? {
        status: "in_service" as const,
        statusReason: returned.toWorkshop.reason,
        statusExpectedBack: dayFrom(context, returned.toWorkshop.backInDays),
      }
    : { status: "available" as const, statusReason: null, statusExpectedBack: null };
}

/**
 * Takes one handed-over demo rental's car back, as the return checklist
 * does: the same photos, the kilometres, any new damage, then the return
 * time (in the past) and the Renter's signature, or "not present" for an
 * after-hours drop-off. One already back is left alone.
 */
export async function returnDemoRental(
  context: DemoContext,
  code: string,
): Promise<"added" | "there"> {
  const plan = DEMO_RENTALS.find((rental) => rental.code === code);
  const rental = await findRental(context, code);
  if (!plan?.returned || !rental) {
    throw new DemoDataError(`Demo rental ${code} needs handing over first.`);
  }
  if (rental.status === "returned") {
    return "there";
  }
  if (rental.status !== "active") {
    throw new DemoDataError(`Demo rental ${code} needs handing over first.`);
  }
  const started = await startReturn(context.deps.database, context.actor, rental.id);
  if (started.status !== "started" && started.status !== "resumed") {
    throw new DemoDataError(`The demo return for ${code} did not start: ${started.status}`);
  }
  await photographEverything(context, await loadDemoReturn(context, started.inspectionId));
  await markDemoDamage(context, await loadDemoReturn(context, started.inspectionId), {
    carNumber: plan.carNumber,
    descriptions: plan.returned.newDamage ?? [],
  });
  await fillDemoDetails(
    context,
    await loadDemoReturn(context, started.inspectionId),
    plan,
    KILOMETRES_DRIVEN_ON_RENTAL,
  );
  const result = await completeReturn(
    context.deps,
    context.actor,
    started.inspectionId,
    {
      shownFingerprint: checklistFingerprint(await loadDemoReturn(context, started.inspectionId)),
      returnedAt: momentOf(context, dayFrom(context, plan.returned.days), plan.returned.time),
      signature: plan.returned.isRenterAbsent ? null : drawnSignatureInput(DEMO_SIGNATURE),
      carAfter: carAfter(context, plan.returned),
    },
    { timeZone: context.timeZone, now: new Date() },
  );
  expectSaved(result.status, ["completed"], `return for ${code}`);
  return "added";
}
