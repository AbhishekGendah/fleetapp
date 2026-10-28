import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { redirect } from "next/navigation";

import { appDb } from "../../lib/app-db";
import { SIGN_IN_PATH } from "../../lib/paths";
import { requireUser } from "../../lib/require-user";
import { loadBusinessDetails } from "../../lib/settings/business-details";
import { AppShell } from "../app-shell";
import { BusinessDetailsForm } from "./business-details-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Later phases add their own sections below business details. */
export default async function SettingsPage() {
  const user = await requireUser();
  const details = await loadBusinessDetails(appDb, user.operatorId);
  if (!details) {
    redirect(SIGN_IN_PATH);
  }

  return (
    <AppShell user={user}>
      <h1 className="text-primary text-2xl font-extrabold">Settings</h1>
      <Card id="business-details">
        <CardHeader>
          <CardTitle>Business details</CardTitle>
          <CardDescription>
            Used on your contracts, invoices and emails, so everything is needed except where it
            says optional.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BusinessDetailsForm details={details} />
        </CardContent>
      </Card>
    </AppShell>
  );
}
