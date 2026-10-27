/**
 * The setup checklist on a new Operator's dashboard (docs/design/01).
 *
 * Each step is either done or still to do, worked out from the Operator's
 * own records, never stored as a tick: it cannot go out of date. Steps
 * whose screens are not built yet say when they arrive instead of linking
 * anywhere.
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

export interface SetupChecklistInput {
  legalName: string;
  abn: string | null;
  addressLine1: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  phone: string | null;
  email: string | null;
  stripeChargesEnabled: boolean;
}

/**
 * Enough to put on a contract or an invoice: who the business is, where it
 * is, and how a Renter reaches it.
 */
function hasBusinessDetails(input: SetupChecklistInput): boolean {
  const required = [
    input.legalName,
    input.abn,
    input.addressLine1,
    input.suburb,
    input.state,
    input.postcode,
    input.phone,
    input.email,
  ];
  return required.every((value) => typeof value === "string" && value.trim().length > 0);
}

const doneIf = (isDone: boolean): SetupStepStatus => (isDone ? "done" : "to_do");

export function getSetupChecklist(input: SetupChecklistInput): SetupStep[] {
  return [
    { key: "business_details", status: doneIf(hasBusinessDetails(input)) },
    // Payments stay blocked until Stripe says charges are enabled.
    { key: "stripe", status: doneIf(input.stripeChargesEnabled) },
    // TODO: decide from real records once contract templates (Phase 3) and
    // cars and renters (Phase 2) exist. Until then nobody can have done them.
    { key: "contract_template", status: "to_do" },
    { key: "cars_and_renters", status: "to_do" },
  ];
}

export function isSetupComplete(steps: readonly SetupStep[]): boolean {
  return steps.every((step) => step.status === "done");
}
