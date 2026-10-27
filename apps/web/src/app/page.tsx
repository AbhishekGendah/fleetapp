import { getGreeting, getSetupChecklist, isSetupComplete } from "@fleetapp/core";
import { Card, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { redirect } from "next/navigation";

import { loadSetupDetails } from "../lib/dashboard/load-setup-details";
import { SIGN_IN_PATH } from "../lib/paths";
import { requireUser } from "../lib/require-user";
import { SetupChecklistCard } from "./setup-checklist-card";
import { SignOutButton } from "./sign-out-button";

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
  const setupDetails = await loadSetupDetails(user.operatorId);
  if (!setupDetails) {
    redirect(SIGN_IN_PATH);
  }
  const steps = getSetupChecklist(setupDetails);

  return (
    <div className="min-h-dvh">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 p-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-semibold">{user.operatorName}</span>
            <span className="text-muted-foreground truncate text-xs">{user.email}</span>
          </div>
          <SignOutButton />
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
        <h1 className="text-xl font-semibold">
          {getGreeting(new Date(), setupDetails.timezone)}, {firstNameOf(user.fullName)}
        </h1>

        {isSetupComplete(steps) ? null : <SetupChecklistCard steps={steps} />}

        <Card>
          <CardHeader>
            <CardTitle>Your dashboard</CardTitle>
            <CardDescription>
              Once you add cars, Renters and rentals, this is where you will see what needs your
              attention, today&rsquo;s pickups and returns, this week&rsquo;s payments, your fleet
              and your fines.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    </div>
  );
}
