import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "../../../../lib/auth";

export const runtime = "nodejs";
// The login system talks to the database on every request, so nothing here
// can be prerendered at build time.
export const dynamic = "force-dynamic";

export const { GET, POST } = toNextJsHandler(auth.handler);
