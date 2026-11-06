import type { SetupStepKey } from "@fleetapp/core";

import { BUSINESS_DETAILS_PATH, CARS_PATH, CONTRACTS_PATH, PAYMENT_SETTINGS_PATH } from "../paths";

export interface SetupStepCopy {
  title: string;
  description: string;
  /** Where the step is done. */
  href: string;
  actionLabel: string;
}

export const SETUP_STEP_COPY: Record<SetupStepKey, SetupStepCopy> = {
  business_details: {
    title: "Add your business details",
    description: "Your ABN, address and contact details, for contracts and invoices.",
    href: BUSINESS_DETAILS_PATH,
    actionLabel: "Add details",
  },
  stripe: {
    title: "Connect Stripe",
    description:
      "So Renters can pay you by direct debit. Once connected, ask Stripe to raise your direct debit limits.",
    href: PAYMENT_SETTINGS_PATH,
    actionLabel: "Connect Stripe",
  },
  contract_template: {
    title: "Set up your rental contract",
    description: "The terms your Renters sign before they drive away.",
    href: CONTRACTS_PATH,
    actionLabel: "Set up contract",
  },
  // Ticked once there is at least one car and one Renter.
  cars_and_renters: {
    title: "Add your cars and Renters",
    description: "Your cars first, then the Renters who hire them.",
    href: CARS_PATH,
    actionLabel: "Add cars",
  },
};
