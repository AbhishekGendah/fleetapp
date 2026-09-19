import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import ws from "ws";

import { dbEnv } from "./env";
import * as schema from "./schema";

// The Neon serverless driver needs a WebSocket implementation in Node.js.
// It supports interactive transactions (BEGIN/COMMIT), which the app needs
// later to set per-request tenant context with `SET LOCAL`.
neonConfig.webSocketConstructor = ws;

declare global {
  // `var` is required here: ambient global declarations don't support `let`/`const`.
  var __fleetappDbPool: Pool | undefined;
}

function getPool(): Pool {
  if (!globalThis.__fleetappDbPool) {
    globalThis.__fleetappDbPool = new Pool({ connectionString: dbEnv.DATABASE_URL });
  }
  return globalThis.__fleetappDbPool;
}

export function getDb(): NeonDatabase<typeof schema> {
  return drizzle(getPool(), { schema });
}
