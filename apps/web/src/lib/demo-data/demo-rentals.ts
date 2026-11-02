import { centsForEditing, localDateTimeToUtc } from "@fleetapp/core";
import { rentals } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, like } from "drizzle-orm";

import { recordBondReceived, reverseBondMovement } from "../bonds/bond-records";
import { renderRentalContract } from "../contracts/contract-pdf";
import { issueDocument } from "../contracts/issued-documents";
import { sendSigningLink } from "../contracts/signing-links";
import { createTemplate, loadDefaultTemplate, type TemplateDetail } from "../contracts/templates";
import { emptyRentalForm, parseRentalForm } from "../rentals/rental-input";
import { cancelRental, createRental, type RentalClock } from "../rentals/rental-records";
import { findCarId } from "./demo-cars";
import {
  checkedInput,
  dayFrom,
  expectSaved,
  momentText,
  type DemoContext,
  DemoDataError,
} from "./demo-context";
import { DEMO_RENTERS, demoRego, wasHandedOver, type DemoRentalPlan } from "./demo-plan";
import { findRenterId } from "./demo-renters";

const DAYS_PER_WEEK = 7;
/** Active rentals were booked this many days before they started. */
const BOOKED_DAYS_AHEAD = 2;
const DEMO_TEMPLATE_NAME = "Demo rental contract";
/** On every demo contract: nobody really signed it. */
export const DEMO_CONTRACT_NOTICE = "Demo data: made up for testing, not signed by a real person.";
const MISTAKEN_BOND_CENTS = 250_00;

function codeMarker(code: string): string {
  return `(demo ${code})`;
}

/** The demo rental with this code, by the marker kept in its notes. */
export async function findRental(
  context: DemoContext,
  code: string,
): Promise<{ id: string; status: string } | null> {
  const [found] = await withTenant(context.deps.database, context.actor.operatorId, (tx) =>
    tx
      .select({ id: rentals.id, status: rentals.status })
      .from(rentals)
      .where(
        and(
          eq(rentals.operatorId, context.actor.operatorId),
          like(rentals.notes, `%${codeMarker(code)}%`),
        ),
      ),
  );
  return found ?? null;
}

/** When an active rental was booked: a little before it started, so it was not booked late. */
export function bookingClock(context: DemoContext, plan: DemoRentalPlan): RentalClock {
  if (!wasHandedOver(plan.kind)) {
    return { timeZone: context.timeZone, now: new Date() };
  }
  const bookedOn = dayFrom(context, plan.startDays - BOOKED_DAYS_AHEAD);
  return { timeZone: context.timeZone, now: momentOf(context, bookedOn, "09:00") };
}

export function momentOf(context: DemoContext, date: string, time: string): Date {
  const moment = localDateTimeToUtc(momentText(date, time), context.timeZone);
  if (!moment) {
    throw new DemoDataError("A demo time falls in a daylight saving gap.");
  }
  return moment;
}

async function partiesOf(context: DemoContext, plan: DemoRentalPlan) {
  const renterName = DEMO_RENTERS.find((renter) => renter.number === plan.renterNumber)?.fullName;
  const [vehicleId, renterId] = await Promise.all([
    findCarId(context, demoRego(plan.carNumber)),
    renterName ? findRenterId(context, renterName) : null,
  ]);
  if (!vehicleId || !renterId) {
    throw new DemoDataError(`Demo rental ${plan.code} needs its car and Renter added first.`);
  }
  return { vehicleId, renterId };
}

async function createDemoRental(context: DemoContext, plan: DemoRentalPlan): Promise<string> {
  const startDate = dayFrom(context, plan.startDays);
  const input = checkedInput(
    parseRentalForm(
      {
        ...emptyRentalForm(await partiesOf(context, plan)),
        type: plan.weeks === null ? "ongoing" : "fixed_term",
        plannedStart: momentText(startDate, plan.startTime),
        plannedEnd:
          plan.weeks === null
            ? ""
            : momentText(
                dayFrom(context, plan.startDays + plan.weeks * DAYS_PER_WEEK),
                plan.startTime,
              ),
        weeklyRateCents: centsForEditing(plan.weeklyRateCents),
        bondCents: centsForEditing(plan.bondCents),
        notes: `${plan.note} ${codeMarker(plan.code)}`,
      },
      context.timeZone,
    ),
    `rental ${plan.code}`,
  );
  const status = plan.kind === "draft" ? "draft" : "booked";
  const result = await createRental(
    context.deps.database,
    context.actor,
    input,
    status,
    bookingClock(context, plan),
  );
  if (result.status !== "saved") {
    throw new DemoDataError(`Demo rental ${plan.code} was not saved: ${result.status}`);
  }
  return result.rentalId;
}

async function receiveBond(
  context: DemoContext,
  rentalId: string,
  payment: { cents: number; method: "cash" | "bank_transfer"; on: string; what: string },
): Promise<string> {
  const result = await recordBondReceived(context.deps.database, context.actor, rentalId, {
    amountCents: payment.cents,
    method: payment.method,
    reference: payment.method === "bank_transfer" ? "DEMO TRANSFER" : null,
    occurredOn: payment.on,
  });
  if (result.status !== "saved") {
    throw new DemoDataError(`Demo bond for ${payment.what} was not saved: ${result.status}`);
  }
  return result.account.movements.at(-1)?.id ?? "";
}

/**
 * The bond paid before the handover. One rental shows a correction: a
 * wrong amount entered, reversed with a reason, then the right one.
 */
async function addDemoBond(context: DemoContext, rentalId: string, plan: DemoRentalPlan) {
  if (plan.bondPaidCents === 0) {
    return;
  }
  const paidOn = dayFrom(context, Math.min(0, plan.startDays - 1));
  const method = plan.renterNumber % 2 === 0 ? "cash" : "bank_transfer";
  if (plan.code === "R03") {
    const mistakeId = await receiveBond(context, rentalId, {
      cents: MISTAKEN_BOND_CENTS,
      method: "cash",
      on: paidOn,
      what: plan.code,
    });
    const reversed = await reverseBondMovement(
      context.deps.database,
      context.actor,
      { rentalId, movementId: mistakeId },
      { note: "Entered the wrong amount" },
      context.today,
    );
    expectSaved(reversed.status, ["saved"], `bond correction for ${plan.code}`);
  }
  await receiveBond(context, rentalId, {
    cents: plan.bondPaidCents,
    method,
    on: paidOn,
    what: plan.code,
  });
}

/** The business's default contract, adding the starter one if it has none yet. */
export async function demoContractTemplate(context: DemoContext): Promise<TemplateDetail> {
  const existing = await loadDefaultTemplate(
    context.deps.database,
    context.actor.operatorId,
    "contract",
  );
  if (existing) {
    return existing;
  }
  await createTemplate(context.deps.database, context.actor, {
    kind: "contract",
    name: DEMO_TEMPLATE_NAME,
  });
  const created = await loadDefaultTemplate(
    context.deps.database,
    context.actor.operatorId,
    "contract",
  );
  if (!created) {
    throw new DemoDataError("The demo contract template was not saved.");
  }
  return created;
}

/**
 * Keeps a contract as if the Renter had signed it, marked as demo data
 * on its face. (A real signature comes only from the Renter's own link.)
 */
export async function issueDemoContract(
  context: DemoContext,
  rentalId: string,
  clock: RentalClock,
): Promise<void> {
  const template = await demoContractTemplate(context);
  const rendered = await renderRentalContract(
    context.deps,
    context.actor.operatorId,
    { rentalId, title: template.name, template: template.content, notice: DEMO_CONTRACT_NOTICE },
    clock,
  );
  if (!rendered) {
    throw new DemoDataError("A demo contract was not made.");
  }
  const issued = await issueDocument(context.deps, context.actor, {
    rentalId,
    kind: "contract",
    templateVersionId: template.latestVersionId,
    pdf: rendered.pdf,
  });
  expectSaved(issued.status, ["issued"], "contract");
}

async function addDemoContract(context: DemoContext, rentalId: string, plan: DemoRentalPlan) {
  if (plan.kind !== "booked") {
    return;
  }
  const clock = { timeZone: context.timeZone, now: new Date() };
  if (plan.contract === "signed") {
    await issueDemoContract(context, rentalId, clock);
  }
  if (plan.contract === "link_sent") {
    await demoContractTemplate(context);
    const sent = await sendSigningLink(context.links, context.actor, rentalId, clock);
    // "missing": the business details the contract quotes are not all filled in yet.
    expectSaved(sent.status, ["sent", "missing"], `contract link for ${plan.code}`);
  }
}

/**
 * Adds one demo rental as the New rental form would, with its bond and
 * contract; a cancelled one is booked and then cancelled with its reason.
 * Active rentals are only booked here: their handover is a step of its own.
 * One already there is left alone.
 */
export async function addDemoRental(
  context: DemoContext,
  plan: DemoRentalPlan,
): Promise<"added" | "there"> {
  if (await findRental(context, plan.code)) {
    return "there";
  }
  const rentalId = await createDemoRental(context, plan);
  await addDemoBond(context, rentalId, plan);
  await addDemoContract(context, rentalId, plan);
  if (plan.kind === "cancelled") {
    const cancelled = await cancelRental(
      context.deps.database,
      context.actor,
      rentalId,
      { reason: plan.cancelReason ?? "Cancelled" },
      new Date(),
    );
    expectSaved(cancelled, ["cancelled"], `cancelling ${plan.code}`);
  }
  return "added";
}
