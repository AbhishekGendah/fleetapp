import type { SetupStepKey } from "@fleetapp/core";

import { BUSINESS_DETAILS_ANCHOR, CARS_PATH, SETTINGS_PATH } from "../paths";

export type SetupStepCopy = {
  title: string;
  description: string;
} & (
  | { /** Where the step is done. */ href: string; actionLabel: string }
  | { /** Until the screen for this step exists, when it is coming. */ comingSoon: string }
);

export const SETUP_STEP_COPY: Record<SetupStepKey, SetupStepCopy> = {
  business_details: {
    title: "Add your business details",
    description: "Your ABN, address and contact details, for contracts and invoices.",
    href: `${SETTINGS_PATH}#${BUSINESS_DETAILS_ANCHOR}`,
    actionLabel: "Add details",
  },
  stripe: {
    title: "Connect Stripe",
    description:
      "So Renters can pay you by direct debit. Once connected, ask Stripe to raise your direct debit limits.",
    comingSoon: "Coming later",
  },
  contract_template: {
    title: "Set up your rental contract",
    description: "The terms your Renters sign before they drive away.",
    comingSoon: "Coming later",
  },
  // Ticked once Renters exist too (Phase 2, step 3); cars can be added now.
  cars_and_renters: {
    title: "Add your cars and Renters",
    description: "Your cars first: Renters are coming soon.",
    href: CARS_PATH,
    actionLabel: "Add cars",
  },
};
