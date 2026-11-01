import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

/**
 * Both apps' browser-test settings: one worker against the app the runner
 * started, a sign-in step first, then every other test signed in.
 */
export function appPlaywrightConfig(options: {
  baseURL: string;
  signInSetupFile: string;
  signedInStatePath: string;
}): PlaywrightTestConfig {
  return defineConfig({
    testDir: "./e2e",
    testMatch: "**/*.e2e.ts",
    fullyParallel: false,
    workers: 1,
    forbidOnly: Boolean(process.env.CI),
    retries: 0,
    reporter: "list",
    use: { baseURL: options.baseURL, trace: "retain-on-failure" },
    projects: [
      { name: "sign-in", testMatch: `**/${options.signInSetupFile}` },
      {
        name: "desktop",
        dependencies: ["sign-in"],
        testIgnore: `**/${options.signInSetupFile}`,
        use: { ...devices["Desktop Chrome"], storageState: options.signedInStatePath },
      },
    ],
  });
}
