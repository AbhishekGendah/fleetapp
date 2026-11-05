// jscpd:ignore-start: Next.js needs this file in each app; the work itself is shared (prepareServer).
/**
 * Runs once as the server starts (Next.js's instrumentation hook): safe
 * error logging, and a refusal to start on an unsafe database login.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const [{ prepareServer }, { appDb }, { authDb }] = await Promise.all([
    import("@fleetapp/db/role-check"),
    import("./lib/app-db"),
    import("./lib/auth"),
  ]);
  await prepareServer({ app: appDb, login: authDb });
}
// jscpd:ignore-end
