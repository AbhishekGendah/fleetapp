import { getGreeting, getSetupChecklist, isSetupComplete } from "@fleetapp/core";
import { Card, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { InstallAppHint } from "@fleetapp/ui/install-app-hint";
import { redirect } from "next/navigation";

import { loadSetupDetails } from "../lib/dashboard/load-setup-details";
import { SIGN_IN_PATH } from "../lib/paths";
import { requireUser } from "../lib/require-user";
import { AppShell } from "./app-shell";
import { SetupChecklistCard } from "./setup-checklist-card";
import { appDb } from "../lib/app-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/**
 * The Operator's dashboard. For now: the setup checklist and a note of what
 * is to come. The real sections, from "needs attention" to fines, arrive
 * with the records behind them (docs/design/09, Phase 7).
 */
export default async function DashboardPage() {
  const user = await requireUser();
  const setupDetails = await loadSetupDetails(appDb, user.operatorId);
  if (!setupDetails) {
    redirect(SIGN_IN_PATH);
  }
  const steps = getSetupChecklist(setupDetails);

  return (
    <AppShell user={user}>
      <h1 className="text-primary text-2xl font-extrabold">
        {getGreeting(new Date(), setupDetails.timezone)}, {firstNameOf(user.fullName)}
      </h1>

      {isSetupComplete(steps) ? null : <SetupChecklistCard steps={steps} />}

      <InstallAppHint />

      <Card>
        <CardHeader>
          <CardTitle>Your dashboard</CardTitle>
          <CardDescription>
            Once you add cars, Renters and rentals, this is where you will see what needs your
            attention, today&rsquo;s pickups and returns, this week&rsquo;s payments, your fleet and
            your fines.
          </CardDescription>
        </CardHeader>
      </Card>
    </AppShell>
  );
}
