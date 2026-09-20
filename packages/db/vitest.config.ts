import { defineConfig } from "vitest/config";

/**
 * These tests run against a real Postgres in Docker, because row-level
 * security, grants and triggers cannot be proven by anything that stands in
 * for the database. Starting the container and migrating it takes a few
 * seconds, hence the raised timeouts.
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
