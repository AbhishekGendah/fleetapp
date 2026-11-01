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

/** A phone about the width rule 24 designs for. */
export const PHONE_VIEWPORT = { width: 375, height: 812 } as const;

/** Made-up Operators, seeded for the list tests. */
export const E2E_OPERATORS = [
  { legalName: "Alpha Cars Pty Ltd", isSuspended: false },
  { legalName: "Bravo Rentals Pty Ltd", isSuspended: true },
  { legalName: "Charlie Fleet Pty Ltd", isSuspended: false },
] as const;
