import type { Metadata } from "next";
import { requireAdmin } from "../../lib/require-admin";
import { AdminShell } from "../admin-shell";
import { ComponentCatalogue } from "./component-catalogue";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Components" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every shared piece the apps are built from, in one place: the standard to
 * look at before approving a change to one, and the place a new piece is
 * added first (rule 29). Behind the Admin sign-in, so only AGS sees it.
 */
export default async function ComponentsPage() {
  await requireAdmin();
  return (
    <AdminShell>
      <h1 className="text-xl font-semibold">Components</h1>
      <p className="text-muted-foreground text-sm">
        The shared pieces every screen is built from. Change one in packages/ui and every screen
        that uses it changes with it.
      </p>
      <ComponentCatalogue />
    </AdminShell>
  );
}
