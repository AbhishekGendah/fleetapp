/** Made-up details for the browser tests' throwaway database only. */
export const E2E_PORT = 3101;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

export const E2E_ADMIN = {
  email: "e2e-admin@example.test",
  fullName: "E2E Admin",
  password: "e2e-only-password-never-used-anywhere-else",
} as const;

/** Where the signed-in browser state and authenticator key are kept between tests. */
export const SIGNED_IN_STATE_PATH = "e2e/.state/signed-in.json";
export const AUTHENTICATOR_KEY_PATH = "e2e/.state/authenticator-key.txt";

export { MINIMUM_TOUCH_TARGET_PX, PHONE_VIEWPORT } from "@fleetapp/e2e/settings";

/** Made-up Operators, seeded for the list tests. */
/** Two cars an Operator typed the same wrong way, for "Fix all" (review of batch 7). */
export const E2E_TYPED_CARS = {
  operatorLegalName: "Alpha Cars Pty Ltd",
  make: "Toyta",
  model: "Corola",
  regos: ["E2E001", "E2E002"],
} as const;

export const E2E_OPERATORS = [
  { legalName: "Alpha Cars Pty Ltd", isSuspended: false },
  { legalName: "Bravo Rentals Pty Ltd", isSuspended: true },
  { legalName: "Charlie Fleet Pty Ltd", isSuspended: false },
] as const;
