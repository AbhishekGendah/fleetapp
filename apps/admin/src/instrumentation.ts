/**
 * Runs once as each server starts (Next.js's instrumentation hook). Makes
 * server error logging safe (review A7-1), then refuses to start if either
 * database login could skip the tenant lock (review G1-4): fail fast, never
 * run without it.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { installSafeErrorLogging } = await import("@fleetapp/core/server");
  installSafeErrorLogging();
  const { assertSafeDatabaseRole } = await import("@fleetapp/db/role-check");
  const { appDb } = await import("./lib/app-db");
  const { authDb } = await import("./lib/auth");
  await assertSafeDatabaseRole(appDb, "app");
  await assertSafeDatabaseRole(authDb, "login");
}
