import { addDemoCar, allDemoCars } from "./demo-cars";
import { addDemoChanges } from "./demo-changes";
import { addDemoDamage } from "./demo-damage";
import { addDemoDocuments } from "./demo-billing";
import { addDemoMoney } from "./demo-money";
import { DemoDataError, type DemoContext } from "./demo-context";
import { handOverDemoRental } from "./demo-handovers";
import { returnDemoRental } from "./demo-returns";
import { addDemoSwap } from "./demo-swaps";
import { addDemoInsurance } from "./demo-insurance";
import {
  DEMO_ACTIVE_RENTAL_CODES,
  DEMO_RENTALS,
  DEMO_RENTERS,
  DEMO_RETURNED_RENTAL_CODES,
  wasHandedOver,
} from "./demo-plan";
import { addDemoRental } from "./demo-rentals";
import { addDemoRenter } from "./demo-renters";

/**
 * Each step is small enough to finish well inside one request's time limit
 * on Vercel; the page runs them one after another.
 */
const CARS_PER_STEP = 10;
const RENTERS_PER_STEP = 8;

export interface DemoStep {
  key: string;
  /** Shown while it runs, e.g. "Cars 1 to 10". */
  label: string;
}

interface RunnableStep extends DemoStep {
  run: (context: DemoContext) => Promise<number>;
}

function inGroups<Item>(items: readonly Item[], size: number): Item[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

/** Runs each item's add in turn, counting only those newly added. */
async function addEach<Item>(
  items: readonly Item[],
  add: (item: Item) => Promise<"added" | "there">,
): Promise<number> {
  let added = 0;
  for (const item of items) {
    added += (await add(item)) === "added" ? 1 : 0;
  }
  return added;
}

function rangeLabel(what: string, first: number, count: number): string {
  return `${what} ${first} to ${first + count - 1}`;
}

const carSteps: RunnableStep[] = inGroups(allDemoCars(), CARS_PER_STEP).map((cars, index) => ({
  key: `cars-${index + 1}`,
  label: rangeLabel("Cars", index * CARS_PER_STEP + 1, cars.length),
  run: (context) => addEach(cars, (car) => addDemoCar(context, car)),
}));

const renterSteps: RunnableStep[] = inGroups(DEMO_RENTERS, RENTERS_PER_STEP).map(
  (group, index) => ({
    key: `renters-${index + 1}`,
    label: rangeLabel("Renters", index * RENTERS_PER_STEP + 1, group.length),
    run: (context) => addEach(group, (plan) => addDemoRenter(context, plan)),
  }),
);

const RENTALS_HANDED_OVER = DEMO_RENTALS.filter((plan) => wasHandedOver(plan.kind));
const OTHER_RENTALS = DEMO_RENTALS.filter((plan) => !wasHandedOver(plan.kind));

const RUNNABLE_STEPS: readonly RunnableStep[] = [
  ...carSteps,
  { key: "insurance", label: "Insurance policies", run: addDemoInsurance },
  ...renterSteps,
  {
    key: "rentals-out",
    label: "Rentals that are out now",
    run: (context) => addEach(RENTALS_HANDED_OVER, (plan) => addDemoRental(context, plan)),
  },
  {
    key: "rentals-other",
    label: "Bookings, drafts and cancelled rentals",
    run: (context) => addEach(OTHER_RENTALS, (plan) => addDemoRental(context, plan)),
  },
  ...DEMO_ACTIVE_RENTAL_CODES.map((code) => ({
    key: `handover-${code}`,
    label: `Handover for rental ${code}`,
    run: (context: DemoContext) => handOverDemoRental(context, code).then(countAdded),
  })),
  ...DEMO_RETURNED_RENTAL_CODES.map((code) => ({
    key: `return-${code}`,
    label: `Return for rental ${code}`,
    run: (context: DemoContext) => returnDemoRental(context, code).then(countAdded),
  })),
  { key: "damage", label: "Damage records and insurance claims", run: addDemoDamage },
  { key: "changes", label: "Changes of terms", run: addDemoChanges },
  { key: "swap", label: "A car swap", run: addDemoSwap },
  { key: "money", label: "Payments", run: addDemoMoney },
  { key: "documents", label: "Invoices and receipts", run: addDemoDocuments },
];

function countAdded(outcome: "added" | "there"): number {
  return outcome === "added" ? 1 : 0;
}

/** The steps in order, for the page to show and run. */
export const DEMO_STEPS: readonly DemoStep[] = RUNNABLE_STEPS.map(({ key, label }) => ({
  key,
  label,
}));

export function isDemoStepKey(key: string): boolean {
  return RUNNABLE_STEPS.some((step) => step.key === key);
}

/** Runs one step; returns how many records it added (none when it ran before). */
export async function runDemoStep(context: DemoContext, key: string): Promise<number> {
  const step = RUNNABLE_STEPS.find((candidate) => candidate.key === key);
  if (!step) {
    throw new DemoDataError(`No demo step is called ${key}.`);
  }
  return step.run(context);
}
