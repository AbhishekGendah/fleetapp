import type { Metadata } from "next";
import {
  firstNameOf,
  formatDayInTimeZone,
  getGreeting,
  getSetupChecklist,
  isSetupComplete,
} from "@fleetapp/core";
import { InstallAppHint } from "@fleetapp/ui/install-app-hint";
import { redirect } from "next/navigation";

import { appDb } from "../lib/app-db";
import { attentionList } from "../lib/dashboard/attention-items";
import { loadDashboard } from "../lib/dashboard/load-dashboard";
import { loadSetupDetails } from "../lib/dashboard/load-setup-details";
import { SIGN_IN_PATH } from "../lib/paths";
import { requireUser } from "../lib/require-user";
import { AppShell } from "./app-shell";
import {
  NeedsAttentionCard,
  QuickActions,
  TodayCard,
  YourCarsCard,
} from "./dashboard/dashboard-cards";
import { SetupChecklistCard } from "./setup-checklist-card";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Dashboard" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Operator's dashboard (docs/plans/look-and-feel.md, slice 2). On a
 * phone, in reading order: greeting, quick actions, setup, needs attention,
 * today, then the cars. On a computer the cars run along the top, with
 * needs attention on the left and today and setup on the right.
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
  const timeZone = user.operatorTimezone;

  return (
    <AppShell user={user}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-0.5">
          <p className="text-teal text-sm font-bold">
            {formatDayInTimeZone(dashboard.window.now, setupDetails.timezone)}
          </p>
          <h1 className="text-primary text-3xl font-extrabold tracking-tight">
            {getGreeting(dashboard.window.now, setupDetails.timezone)}, {firstNameOf(user.fullName)}
          </h1>
        </div>
        <QuickActions />
      </div>

      {/* Placed by grid on a computer; the order here is the phone's, and the reading order. */}
      <div className="grid gap-4 lg:grid-cols-2 lg:grid-rows-[auto_auto_1fr] lg:items-start">
        {isSetupComplete(steps) ? null : (
          <div className="lg:col-start-2 lg:row-start-3">
            <SetupChecklistCard steps={steps} />
          </div>
        )}
        <div className="lg:col-start-1 lg:row-span-2 lg:row-start-2">
          <NeedsAttentionCard attention={attentionList(dashboard, timeZone)} />
        </div>
        <div className="lg:col-start-2 lg:row-start-2">
          <TodayCard data={dashboard} timeZone={timeZone} />
        </div>
        <div className="lg:col-span-2 lg:row-start-1">
          <YourCarsCard data={dashboard} />
        </div>
      </div>

      <InstallAppHint />
    </AppShell>
  );
}
