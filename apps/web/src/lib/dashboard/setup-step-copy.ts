import type { SetupStepKey } from "@fleetapp/core";

import { BUSINESS_DETAILS_PATH, CARS_PATH, CONTRACTS_PATH, PAYMENT_SETTINGS_PATH } from "../paths";

export interface SetupStepCopy {
  title: string;
  /** Where the step is done. */
  href: string;
}

export const SETUP_STEP_COPY: Record<SetupStepKey, SetupStepCopy> = {
  business_details: {
    title: "Add your business details",
    href: BUSINESS_DETAILS_PATH,
  },
  stripe: {
    title: "Connect Stripe",
    href: PAYMENT_SETTINGS_PATH,
  },
  contract_template: {
    title: "Set up your rental contract",
    href: CONTRACTS_PATH,
  },
  // Ticked once there is at least one car and one Renter.
  cars_and_renters: {
    title: "Add your cars and Renters",
    href: CARS_PATH,
  },
};
