import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { redirect } from "next/navigation";

import { appDb } from "../../lib/app-db";
import { loadOperatorLogoUrl } from "../../lib/files/operator-logo";
import { BUSINESS_DETAILS_ANCHOR, SIGN_IN_PATH } from "../../lib/paths";
import { requireUser } from "../../lib/require-user";
import { loadBusinessDetails } from "../../lib/settings/business-details";
import { AppShell } from "../app-shell";
import { BusinessDetailsForm } from "./business-details-form";
import { LogoUpload } from "./logo-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Later phases add their own sections below business details. */
export default async function SettingsPage() {
  const user = await requireUser();
  const [details, logoUrl] = await Promise.all([
    loadBusinessDetails(appDb, user.operatorId),
    loadOperatorLogoUrl(user.operatorId),
  ]);
  if (!details) {
    redirect(SIGN_IN_PATH);
  }

  return (
    <AppShell user={user}>
      <h1 className="text-primary text-2xl font-extrabold">Settings</h1>
      <Card id={BUSINESS_DETAILS_ANCHOR}>
        <CardHeader>
          <CardTitle>Business details</CardTitle>
          <CardDescription>Used on your contracts, invoices and emails.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-8">
          <LogoUpload logoUrl={logoUrl} />
          <BusinessDetailsForm details={details} />
        </CardContent>
      </Card>
    </AppShell>
  );
}
