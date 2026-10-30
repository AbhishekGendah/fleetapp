import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { redirect } from "next/navigation";

import { appDb } from "../../lib/app-db";
import { loadOperatorLogoUrl } from "../../lib/files/operator-logo";
import { BUSINESS_DETAILS_ANCHOR, SIGN_IN_PATH } from "../../lib/paths";
import { requireUser } from "../../lib/require-user";
import { loadBusinessDetails } from "../../lib/settings/business-details";
import { AppShell } from "../app-shell";
import { loadOperatorSettings } from "../../lib/settings/operator-settings";
import { BusinessDetailsForm } from "./business-details-form";
import { WarningDaysForm } from "./warning-days-form";
import { LogoUpload } from "./logo-upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Later phases add their own sections below business details. */
export default async function SettingsPage() {
  const user = await requireUser();
  const [details, logoUrl, settings] = await Promise.all([
    loadBusinessDetails(appDb, user.operatorId),
    loadOperatorLogoUrl(user.operatorId),
    loadOperatorSettings(appDb, user.operatorId),
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
      <Card>
        <CardHeader>
          <CardTitle>Cars</CardTitle>
          <CardDescription>Shown on the cars list and each car&rsquo;s page.</CardDescription>
        </CardHeader>
        <CardContent>
          <WarningDaysForm
            setting="vehicleExpiryWarningDays"
            label="Show “Due soon” this many days before rego or insurance expires"
            warningDays={settings.vehicleExpiryWarningDays}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Renters</CardTitle>
          <CardDescription>Shown on the Renters list and each Renter&rsquo;s page.</CardDescription>
        </CardHeader>
        <CardContent>
          <WarningDaysForm
            setting="licenceExpiryWarningDays"
            label="Show “Due soon” this many days before a licence expires"
            warningDays={settings.licenceExpiryWarningDays}
          />
        </CardContent>
      </Card>
    </AppShell>
  );
}
