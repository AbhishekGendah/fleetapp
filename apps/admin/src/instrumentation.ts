// jscpd:ignore-start: Next.js needs this file in each app; the work itself is shared (prepareServer).
/**
 * Runs once as the server starts (Next.js's instrumentation hook): safe
 * error logging, and a refusal to start on an unsafe database login or on
 * transactions that don't hold together. The checks open and close their
 * own connections: this hook is bundled apart from the pages, and must never
 * make the pool they run on.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const [{ prepareServer }, { env }] = await Promise.all([
    import("@fleetapp/db/role-check"),
    import("./env"),
  ]);
  await prepareServer({ app: env.DATABASE_URL, login: env.AUTH_DATABASE_URL });
}
// jscpd:ignore-end
