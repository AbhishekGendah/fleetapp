import { healthResponse } from "@fleetapp/db/health";

export const runtime = "nodejs";
// Never prerendered, so the build itself never opens a database connection.
export const dynamic = "force-dynamic";

export const GET = healthResponse;
