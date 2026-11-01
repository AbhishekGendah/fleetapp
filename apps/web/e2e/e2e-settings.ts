/** Made-up details for the browser tests' throwaway database only. */
export const E2E_PORT = 3100;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

export const E2E_USER = {
  email: "e2e-user@example.test",
  fullName: "E2E User",
  password: "e2e-only-operator-password-never-used-elsewhere",
} as const;

export const E2E_BUCKETS = { general: "e2e-general", identity: "e2e-identity" } as const;

/** Where the signed-in browser state and authenticator key are kept between tests. */
export const SIGNED_IN_STATE_PATH = "e2e/.state/signed-in.json";
export const AUTHENTICATOR_KEY_PATH = "e2e/.state/authenticator-key.txt";

export { MINIMUM_TOUCH_TARGET_PX, PHONE_VIEWPORT } from "@fleetapp/e2e/settings";
