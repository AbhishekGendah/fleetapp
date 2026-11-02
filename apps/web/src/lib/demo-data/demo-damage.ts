import { centsForEditing } from "@fleetapp/core";

import { claimFormSchema } from "../damage/damage-input";
import { listCarDamage, loadClaimDefaults, whoHadCar } from "../damage/damage-queries";
import {
  changeDamageStatus,
  confirmDamageRental,
  recordFoundDamage,
  saveClaim,
} from "../damage/damage-records";
import { findCarId } from "./demo-cars";
import {
  checkedInput,
  dayFrom,
  DemoDataError,
  expectSaved,
  type DemoContext,
} from "./demo-context";
import { demoRego } from "./demo-plan";

/** What happens to one piece of demo damage after it is recorded. */
interface DemoDamagePlan {
  carNumber: number;
  description: string;
  /** Found away from a checklist this many days ago; absent when it came from a demo return. */
  foundDaysAgo?: number;
  status?: { status: "repaired" } | { status: "not_repairing"; statusNote: string };
  claim?: {
    status: "lodged" | "declined" | "paid";
    claimNumber: string;
    lodgedDaysAgo: number;
    settledDaysAgo?: number;
    payout?: string;
    notes?: string;
  };
}

/** The demo returns' new damage (R35, R36) and two found later, with claims at different stages. */
const DEMO_DAMAGE: readonly DemoDamagePlan[] = [
  {
    carNumber: 35,
    description: "Scratch on boot lid",
    claim: { status: "lodged", claimNumber: "CLM-20431", lodgedDaysAgo: 8 },
  },
  {
    carNumber: 35,
    description: "Chipped windscreen",
    status: { status: "not_repairing", statusNote: "Small chip outside the driver's view." },
    claim: {
      status: "declined",
      claimNumber: "CLM-20432",
      lodgedDaysAgo: 8,
      settledDaysAgo: 4,
      notes: "Under the excess, so the insurer declined it.",
    },
  },
  { carNumber: 34, description: "Kerb rash on front left wheel", status: { status: "repaired" } },
  // Out with a Renter now: reported by them, so who had it is confirmed from the rental.
  { carNumber: 3, description: "Cracked tail light, reported by the Renter", foundDaysAgo: 2 },
  // Between rentals: nobody had it, and the insurer has paid.
  {
    carNumber: 38,
    description: "Car park dent in rear bumper",
    foundDaysAgo: 12,
    status: { status: "repaired" },
    claim: {
      status: "paid",
      claimNumber: "CLM-19877",
      lodgedDaysAgo: 11,
      settledDaysAgo: 3,
      payout: "1,180.00",
    },
  },
];

async function demoCarId(context: DemoContext, carNumber: number): Promise<string> {
  const carId = await findCarId(context, demoRego(carNumber));
  if (!carId) {
    throw new DemoDataError(`Demo car ${demoRego(carNumber)} needs adding first.`);
  }
  return carId;
}

/** Records damage found away from a checklist, confirming who had the car if anyone did. */
async function recordFoundDemoDamage(
  context: DemoContext,
  carId: string,
  plan: DemoDamagePlan & { foundDaysAgo: number },
): Promise<string> {
  const foundOn = dayFrom(context, -plan.foundDaysAgo);
  const added = await recordFoundDamage(context.deps.database, context.actor, carId, {
    foundOn,
    description: plan.description,
    x: null,
    y: null,
    rentalId: null,
  });
  if (added.status !== "added") {
    throw new DemoDataError(`Demo damage "${plan.description}" was not saved.`);
  }
  const holder = await whoHadCar(context.deps.database, context.actor.operatorId, {
    vehicleId: carId,
    day: foundOn,
    timeZone: context.timeZone,
  });
  if (holder) {
    const confirmed = await confirmDamageRental(
      context.deps.database,
      context.actor,
      added.damageId,
      holder.rentalId,
    );
    expectSaved(confirmed, ["changed"], `holder for "${plan.description}"`);
  }
  return added.damageId;
}

async function addDemoClaim(
  context: DemoContext,
  record: { id: string; vehicleId: string; foundOn: string },
  claim: NonNullable<DemoDamagePlan["claim"]>,
): Promise<void> {
  const defaults = await loadClaimDefaults(context.deps.database, context.actor.operatorId, {
    vehicleId: record.vehicleId,
    foundOn: record.foundOn,
    timeZone: context.timeZone,
  });
  const day = (daysAgo: number | undefined) =>
    daysAgo === undefined ? "" : dayFrom(context, -daysAgo);
  const input = checkedInput(
    claimFormSchema.safeParse({
      policyId: defaults?.policyId ?? "",
      insurer: defaults?.insurer ?? "Demo Insurance",
      claimNumber: claim.claimNumber,
      status: claim.status,
      excessCents: defaults?.excessCents ? centsForEditing(defaults.excessCents) : "",
      lodgedOn: day(claim.lodgedDaysAgo),
      settledOn: day(claim.settledDaysAgo),
      payoutCents: claim.payout ?? "",
      notes: claim.notes ?? "",
    }),
    `claim ${claim.claimNumber}`,
  );
  const saved = await saveClaim(context.deps.database, context.actor, record.id, input);
  expectSaved(saved, ["saved"], `claim ${claim.claimNumber}`);
}

/** A record already taken to its planned status and claim, so a re-run leaves it alone. */
function isAtItsStage(
  record: { status: string; claimStatus: string | null },
  plan: DemoDamagePlan,
): boolean {
  const isStatusDone = !plan.status || record.status === plan.status.status;
  const isClaimDone = !plan.claim || record.claimStatus === plan.claim.status;
  return isStatusDone && isClaimDone;
}

/**
 * Takes each demo damage record to its stage: found later ones recorded,
 * statuses set and claims made. A record already there is left alone;
 * damage from a return that ran before damage records existed is skipped.
 */
export async function addDemoDamage(context: DemoContext): Promise<number> {
  let added = 0;
  for (const plan of DEMO_DAMAGE) {
    const carId = await demoCarId(context, plan.carNumber);
    const existing = (
      await listCarDamage(context.deps.database, context.actor.operatorId, carId)
    ).find((record) => record.description === plan.description);
    if (existing && isAtItsStage(existing, plan)) {
      continue;
    }
    const damageId =
      existing?.id ??
      (plan.foundDaysAgo === undefined
        ? null
        : await recordFoundDemoDamage(context, carId, {
            ...plan,
            foundDaysAgo: plan.foundDaysAgo,
          }));
    if (!damageId) {
      continue;
    }
    if (plan.status) {
      const changed = await changeDamageStatus(context.deps.database, context.actor, damageId, {
        statusNote: null,
        ...plan.status,
      });
      expectSaved(changed, ["changed"], `status of "${plan.description}"`);
    }
    if (plan.claim) {
      const foundOn = existing?.foundOn ?? dayFrom(context, -(plan.foundDaysAgo ?? 0));
      await addDemoClaim(context, { id: damageId, vehicleId: carId, foundOn }, plan.claim);
    }
    added += 1;
  }
  return added;
}
