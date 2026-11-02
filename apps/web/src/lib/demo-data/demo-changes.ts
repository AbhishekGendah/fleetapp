import { addDays, earliestRateDay, type TemplateDocument } from "@fleetapp/core";

import { createTemplate, loadDefaultTemplate, saveTemplate } from "../contracts/templates";
import { changeWeeklyRate, listRentalChanges } from "../rentals/change-signing";
import { changeRentalEnd } from "../rentals/rental-changes";
import { loadRental } from "../rentals/rental-queries";
import { DemoDataError, expectSaved, type DemoContext } from "./demo-context";
import { findRental } from "./demo-rentals";

const DEMO_CHANGE_TEMPLATE_NAME = "Demo change of terms";
/** Two more weeks on a fixed-term rental. */
const EXTENSION_DAYS = 14;
/** A $20 rise, waiting for the Renter's signature. */
const RATE_RISE_CENTS = 20_00;
/** R03: an 8-week rental extended. R05: a 12-week rental with a rate rise waiting. */
const EXTENDED_RENTAL = "R03";
const RATE_CHANGE_RENTAL = "R05";

/** A short change form that uses only what every demo rental has on file. */
const DEMO_CHANGE_FORM: TemplateDocument = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Change of terms" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Demo data: made up for testing. " },
        { type: "mergeField", attrs: { key: "renterFullName" } },
        { type: "text", text: ", rental of " },
        { type: "mergeField", attrs: { key: "carRego" } },
        { type: "text", text: ": " },
        { type: "mergeField", attrs: { key: "changeSummary" } },
        { type: "text", text: " Why: " },
        { type: "mergeField", attrs: { key: "changeReason" } },
      ],
    },
  ],
};

/** The business's default change-of-terms template, adding a demo one if it has none. */
async function ensureChangeTemplate(context: DemoContext): Promise<void> {
  const { database } = context.deps;
  if (await loadDefaultTemplate(database, context.actor.operatorId, "change_of_terms")) {
    return;
  }
  const templateId = await createTemplate(database, context.actor, {
    kind: "change_of_terms",
    name: DEMO_CHANGE_TEMPLATE_NAME,
  });
  await saveTemplate(database, context.actor, templateId, {
    name: DEMO_CHANGE_TEMPLATE_NAME,
    content: DEMO_CHANGE_FORM,
  });
}

async function demoRental(context: DemoContext, code: string) {
  const found = await findRental(context, code);
  const clock = { timeZone: context.timeZone, now: new Date() };
  const rental = found
    ? await loadRental(context.deps.database, context.actor.operatorId, found.id, clock)
    : null;
  if (!rental?.plannedEnd || rental.status !== "active") {
    throw new DemoDataError(`Demo rental ${code} needs handing over first.`);
  }
  const changes = await listRentalChanges(
    context.deps.database,
    context.actor.operatorId,
    rental.id,
    clock.now,
  );
  return { rental, clock, hasChanges: changes.length > 0 };
}

/**
 * Changes of terms for the demo: one rental extended two weeks, another
 * with a weekly rate rise sent to its Renter (to the test inbox) and waiting
 * for their signature. Rentals already changed are left alone.
 */
export async function addDemoChanges(context: DemoContext): Promise<number> {
  await ensureChangeTemplate(context);
  let added = 0;
  const extended = await demoRental(context, EXTENDED_RENTAL);
  if (!extended.hasChanges) {
    const newEnd = new Date(extended.rental.plannedEnd!.getTime());
    newEnd.setUTCDate(newEnd.getUTCDate() + EXTENSION_DAYS);
    const result = await changeRentalEnd(
      context.deps.database,
      context.actor,
      extended.rental.id,
      { newEnd, reason: "Renter asked for two more weeks" },
      extended.clock,
    );
    expectSaved(result.status, ["changed"], `extension of ${EXTENDED_RENTAL}`);
    added += 1;
  }
  const raised = await demoRental(context, RATE_CHANGE_RENTAL);
  if (!raised.hasChanges) {
    const appliesFrom = addDays(earliestRateDay(raised.clock.now, context.timeZone), 1);
    const result = await changeWeeklyRate(
      context.links,
      context.actor,
      raised.rental.id,
      {
        weeklyRateCents: raised.rental.weeklyRateCents + RATE_RISE_CENTS,
        appliesFrom,
        reason: "Insurance went up",
      },
      { ...raised.clock, currentRateCents: raised.rental.weeklyRateCents },
    );
    expectSaved(result.status, ["sent"], `rate change on ${RATE_CHANGE_RENTAL}`);
    added += 1;
  }
  return added;
}
