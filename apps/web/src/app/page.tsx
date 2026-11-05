import type { Metadata } from "next";
import { getGreeting, getSetupChecklist, isSetupComplete } from "@fleetapp/core";
import { InstallAppHint } from "@fleetapp/ui/install-app-hint";
import { redirect } from "next/navigation";

import { loadDashboard } from "../lib/dashboard/load-dashboard";
import { loadSetupDetails } from "../lib/dashboard/load-setup-details";
import { SIGN_IN_PATH } from "../lib/paths";
import { requireUser } from "../lib/require-user";
import { AppShell } from "./app-shell";
import {
  FleetCard,
  NeedsAttentionCard,
  QuickActions,
  ThisWeekCard,
} from "./dashboard/dashboard-cards";
import { SetupChecklistCard } from "./setup-checklist-card";
import { appDb } from "../lib/app-db";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Dashboard" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/**
 * The Operator's dashboard (docs/design/09, docs/plans/this-week.md): what
 * needs attention, today and this week, then the fleet. Money and fines
 * join it with the records behind them.
 */
export default async function DashboardPage() {
  const user = await requireUser();
  const [setupDetails, dashboard] = await Promise.all([
    loadSetupDetails(appDb, user.operatorId),
    loadDashboard(user),
  ]);
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

      <QuickActions />
      <NeedsAttentionCard data={dashboard} timeZone={user.operatorTimezone} />
      <ThisWeekCard data={dashboard} timeZone={user.operatorTimezone} />
      <FleetCard data={dashboard} timeZone={user.operatorTimezone} />

      <InstallAppHint />
    </AppShell>
  );
}
