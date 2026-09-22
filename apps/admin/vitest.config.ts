import { defineConfig } from "vitest/config";

/**
 * The login tests run against a real Postgres with the real migrations
 * applied. Nothing standing in for the database can prove that the table and
 * column mapping in auth-options.ts is right, and that mapping is exactly what
 * would fail silently until someone tried to sign in.
 */
const CONTAINER_STARTUP_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = 30_000;

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./test/global-setup.ts"],
    teardownTimeout: CONTAINER_STARTUP_TIMEOUT_MS,
    hookTimeout: CONTAINER_STARTUP_TIMEOUT_MS,
    testTimeout: TEST_TIMEOUT_MS,
  },
});
