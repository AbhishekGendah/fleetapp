import { appPlaywrightConfig } from "@fleetapp/e2e/playwright-config";

import { E2E_BASE_URL, SIGNED_IN_STATE_PATH } from "./e2e/e2e-settings";

/** Started by e2e/run.ts, which provides the database and the running app. */
export default appPlaywrightConfig({
  baseURL: E2E_BASE_URL,
  signInSetupFile: "sign-in.setup.e2e.ts",
  signedInStatePath: SIGNED_IN_STATE_PATH,
});
