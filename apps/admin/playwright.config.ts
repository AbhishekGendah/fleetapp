import { defineConfig, devices } from "@playwright/test";

import { E2E_BASE_URL, SIGNED_IN_STATE_PATH } from "./e2e/e2e-settings";

/** Started by e2e/run.ts, which provides the database and the running app. */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: "list",
  use: { baseURL: E2E_BASE_URL, trace: "retain-on-failure" },
  projects: [
    { name: "sign-in", testMatch: "**/sign-in.setup.e2e.ts" },
    {
      name: "desktop",
      dependencies: ["sign-in"],
      testIgnore: "**/sign-in.setup.e2e.ts",
      use: { ...devices["Desktop Chrome"], storageState: SIGNED_IN_STATE_PATH },
    },
  ],
});
