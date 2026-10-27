import { Card, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";

import { requireUser } from "../../lib/require-user";
import { AppShell } from "../app-shell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// TODO: business details arrive in Phase 1b slice 2; later phases add their
// own sections here.
export default async function SettingsPage() {
  const user = await requireUser();

  return (
    <AppShell user={user}>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Business details</CardTitle>
          <CardDescription>Your ABN, address and contact details. Coming next.</CardDescription>
        </CardHeader>
      </Card>
    </AppShell>
  );
}
