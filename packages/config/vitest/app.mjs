import { fileURLToPath } from "node:url";

/**
 * The test setup both apps share. Their tests run against a real Postgres
 * with the real migrations applied, started once per run by the app's own
 * `test/global-setup.ts`: nothing standing in for the database can prove
 * that tenancy and the login table mapping really hold.
 */
const CONTAINER_STARTUP_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = 30_000;

export const appTestConfig = {
  resolve: {
    alias: { "server-only": fileURLToPath(new URL("./server-only-stub.mjs", import.meta.url)) },
  },
  // Some tests load screen definitions written in JSX; Next builds those itself.
  oxc: { jsx: { runtime: /** @type {const} */ ("automatic") } },
  test: {
    environment: "node",
    globalSetup: ["./test/global-setup.ts"],
    teardownTimeout: CONTAINER_STARTUP_TIMEOUT_MS,
    hookTimeout: CONTAINER_STARTUP_TIMEOUT_MS,
    testTimeout: TEST_TIMEOUT_MS,
  },
};
