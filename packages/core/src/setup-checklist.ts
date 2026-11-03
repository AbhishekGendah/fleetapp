import { hasRequiredBusinessDetails, type RequiredBusinessDetails } from "./business-details";

/**
 * The setup checklist on a new Operator's dashboard (docs/design/01).
 *
 * Each step is either done or still to do, worked out from the Operator's
 * own records, never stored as a tick: it cannot go out of date.
 */
export const SETUP_STEP_KEYS = [
  "business_details",
  "stripe",
  "contract_template",
  "cars_and_renters",
] as const;
export type SetupStepKey = (typeof SETUP_STEP_KEYS)[number];

export type SetupStepStatus = "done" | "to_do";

export interface SetupStep {
  key: SetupStepKey;
  status: SetupStepStatus;
}

export interface SetupChecklistInput extends RequiredBusinessDetails {
  stripeChargesEnabled: boolean;
  /** The business has its own rental contract (a template of that kind, in use). */
  hasContractTemplate: boolean;
  /** At least one car and at least one Renter, not archived. */
  hasCars: boolean;
  hasRenters: boolean;
}

const doneIf = (isDone: boolean): SetupStepStatus => (isDone ? "done" : "to_do");

export function getSetupChecklist(input: SetupChecklistInput): SetupStep[] {
  return [
    { key: "business_details", status: doneIf(hasRequiredBusinessDetails(input)) },
    // Payments stay blocked until Stripe says charges are enabled.
    { key: "stripe", status: doneIf(input.stripeChargesEnabled) },
    { key: "contract_template", status: doneIf(input.hasContractTemplate) },
    { key: "cars_and_renters", status: doneIf(input.hasCars && input.hasRenters) },
  ];
}

export function isSetupComplete(steps: readonly SetupStep[]): boolean {
  return steps.every((step) => step.status === "done");
}
