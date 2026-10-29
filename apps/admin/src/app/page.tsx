import { redirect } from "next/navigation";

import { requireAdmin } from "../lib/require-admin";
import { OPERATORS_PATH } from "../lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function HomePage() {
  await requireAdmin();
  redirect(OPERATORS_PATH);
}
