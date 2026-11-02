import { centsForEditing, gstIncludedIn } from "@fleetapp/core";

import { emptyPolicyForm, parsePolicyForm } from "../vehicles/paperwork-input";
import { createPolicy } from "../vehicles/insurance";
import { findCarId } from "./demo-cars";
import { checkedInput, dayFrom, expectSaved, type DemoContext } from "./demo-context";
import { demoRego } from "./demo-plan";

interface DemoPolicy {
  insurer: string;
  policyNumber: string;
  coverType: "comprehensive" | "third_party_fire_theft" | "third_party_property";
  startDays: number;
  endDays: number;
  paymentFrequency: "yearly" | "monthly" | "fortnightly";
  costCents: number;
  excessCents: number;
  carNumbers: readonly number[];
}

function carRange(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

const YEAR_DAYS = 365;

/**
 * Fleet policies from made-up insurers: last year's (now ended), this
 * year's, one about to run out and one already run out, so every insurance
 * state shows on the cars list. Cars 46 to 50 have none.
 */
const DEMO_POLICIES: readonly DemoPolicy[] = [
  {
    insurer: "Demo Fleet Insurance",
    policyNumber: "DFI-2025-001",
    coverType: "comprehensive",
    startDays: -200 - YEAR_DAYS,
    endDays: -200,
    paymentFrequency: "yearly",
    costCents: 38_500_00,
    excessCents: 1_500_00,
    carNumbers: carRange(1, 20),
  },
  {
    insurer: "Demo Fleet Insurance",
    policyNumber: "DFI-2026-001",
    coverType: "comprehensive",
    startDays: -200,
    endDays: YEAR_DAYS - 200,
    paymentFrequency: "monthly",
    costCents: 3_650_00,
    excessCents: 1_500_00,
    carNumbers: carRange(1, 30),
  },
  {
    insurer: "Example Mutual",
    policyNumber: "EXM-778812",
    coverType: "third_party_fire_theft",
    startDays: 12 - YEAR_DAYS,
    endDays: 12,
    paymentFrequency: "fortnightly",
    costCents: 640_00,
    excessCents: 800_00,
    carNumbers: carRange(31, 40),
  },
  {
    insurer: "Sample Underwriters",
    policyNumber: "SU-55102",
    coverType: "third_party_property",
    startDays: -20 - YEAR_DAYS,
    endDays: -20,
    paymentFrequency: "yearly",
    costCents: 2_900_00,
    excessCents: 500_00,
    carNumbers: carRange(41, 45),
  },
];

async function carIdsFor(context: DemoContext, carNumbers: readonly number[]): Promise<string[]> {
  const ids = await Promise.all(carNumbers.map((number) => findCarId(context, demoRego(number))));
  return ids.filter((id): id is string => id !== null);
}

/** Adds the demo policies with their cars. A policy already there is left alone. */
export async function addDemoInsurance(context: DemoContext): Promise<number> {
  let added = 0;
  for (const policy of DEMO_POLICIES) {
    const input = checkedInput(
      parsePolicyForm({
        ...emptyPolicyForm(),
        insurer: policy.insurer,
        policyNumber: policy.policyNumber,
        coverType: policy.coverType,
        startsOn: dayFrom(context, policy.startDays),
        endsOn: dayFrom(context, policy.endDays),
        excessCents: centsForEditing(policy.excessCents),
        paymentFrequency: policy.paymentFrequency,
        costCents: centsForEditing(policy.costCents),
        gstCents: centsForEditing(gstIncludedIn(policy.costCents)),
      }),
      `policy ${policy.policyNumber}`,
    );
    const carIds = await carIdsFor(context, policy.carNumbers);
    const result = await createPolicy(context.deps.database, context.actor, input, carIds);
    expectSaved(result.status, ["created", "duplicate"], `policy ${policy.policyNumber}`);
    added += result.status === "created" ? 1 : 0;
  }
  return added;
}
