import { redirect } from "next/navigation";

import { requireAdmin } from "../lib/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function HomePage() {
  await requireAdmin();
  redirect("/operators");
}
