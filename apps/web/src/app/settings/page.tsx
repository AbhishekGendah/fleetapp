import type { Metadata } from "next";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { RequiredFieldsNote } from "@fleetapp/ui/input";
import { DatabaseZap, FileText, Landmark, ReceiptText } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { appDb } from "../../lib/app-db";
import { loadOperatorLogoUrl } from "../../lib/files/operator-logo";
import { isDemoDataAllowed } from "../../lib/demo-data/demo-access";
import {
  BUSINESS_DETAILS_ANCHOR,
  CHARGE_TYPES_PATH,
  INVOICE_SETTINGS_PATH,
  PAYMENT_SETTINGS_PATH,
  CONTRACTS_PATH,
  DEMO_DATA_PATH,
  SIGN_IN_PATH,
} from "../../lib/paths";
import { requireUser } from "../../lib/require-user";
import { loadBusinessDetails } from "../../lib/settings/business-details";
import { AppShell } from "../app-shell";
import { choiceSettingValue } from "../../lib/settings/choice-setting-input";
import { loadOperatorSettings } from "../../lib/settings/operator-settings";
import { BusinessDetailsForm } from "./business-details-form";
import { ChoiceSettingForm } from "./choice-setting-form";
import { NumberSettingForm } from "./number-setting-form";
import { PhotoListForm } from "./photo-list-form";
import { LogoUpload } from "./logo-upload";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Settings" };

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
        <CardContent className="flex flex-col gap-4">
          <RequiredFieldsNote />
          <NumberSettingForm
            setting="vehicleExpiryWarningDays"
            label="Show “Due soon” this many days before rego or insurance expires"
            value={settings.vehicleExpiryWarningDays}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Renters</CardTitle>
          <CardDescription>Shown on the Renters list and each Renter&rsquo;s page.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-8">
          <RequiredFieldsNote />
          <NumberSettingForm
            setting="licenceExpiryWarningDays"
            label="Show “Due soon” this many days before a licence expires"
            value={settings.licenceExpiryWarningDays}
          />
          <NumberSettingForm
            setting="renterLinkValidDays"
            label="Details form links last this many days"
            value={settings.renterLinkValidDays}
          />
          <NumberSettingForm
            setting="licenceScanKeptMonths"
            label="Delete licence scans this many months after the Renter’s last rental, or after they were added"
            hint="Licence photos are identity documents: keep them only as long as you need them. The licence details themselves are kept."
            value={settings.licenceScanKeptMonths}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Contracts</CardTitle>
          <CardDescription>
            Your rental contract and forms, written once and filled in for each rental.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href={CONTRACTS_PATH}>
              <FileText aria-hidden />
              Contract templates
            </Link>
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Charges</CardTitle>
          <CardDescription>
            What you charge Renters for (rent, cleaning, tolls, your own), whether each includes
            GST, how invoices are numbered and sent, your Stripe account, and when money owing
            counts as overdue.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href={CHARGE_TYPES_PATH}>
              <ReceiptText aria-hidden />
              Charge types
            </Link>
          </Button>
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href={INVOICE_SETTINGS_PATH}>
              <FileText aria-hidden />
              Invoices
            </Link>
          </Button>
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href={PAYMENT_SETTINGS_PATH}>
              <Landmark aria-hidden />
              Payments
            </Link>
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Rentals</CardTitle>
          <CardDescription>
            Each new rental keeps the settings it was made with: a change here applies to rentals
            made from now on, never to ones already made.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-8">
          <RequiredFieldsNote />
          <NumberSettingForm
            setting="minimumRenterAgeYears"
            label="The youngest a Renter may be when the rental starts (years)"
            value={settings.minimumRenterAgeYears}
          />
          <ChoiceSettingForm
            setting="isProvisionalLicenceAllowed"
            label="May a Renter with a provisional (P plate) licence rent?"
            value={choiceSettingValue(
              "isProvisionalLicenceAllowed",
              settings.isProvisionalLicenceAllowed,
            )}
            hint="Check what your insurance allows."
          />
          <NumberSettingForm
            setting="longTermMinimumDays"
            label="Rentals booked for at least this many days get the long-term price (days)"
            hint="Ongoing rentals always do. One that comes back sooner is re-priced at the daily rate, unless you waive it at the return."
            value={settings.longTermMinimumDays}
          />
          <NumberSettingForm
            setting="graceMinutes"
            label="Minutes a car can be late back before another day is charged"
            hint="Rent is counted in 24-hour blocks from the handover."
            value={settings.graceMinutes}
          />
          <ChoiceSettingForm
            setting="isBondRequiredBeforeHandover"
            label="Must the bond be paid before the car is handed over?"
            value={choiceSettingValue(
              "isBondRequiredBeforeHandover",
              settings.isBondRequiredBeforeHandover,
            )}
          />
          <ChoiceSettingForm
            setting="isDirectDebitRequiredBeforeHandover"
            label="Must the Renter's direct debit be set up before the car is handed over?"
            hint="Only once you take payments by Stripe (Settings → Payments)."
            value={choiceSettingValue(
              "isDirectDebitRequiredBeforeHandover",
              settings.isDirectDebitRequiredBeforeHandover,
            )}
          />
          <NumberSettingForm
            setting="bondHoldDaysAfterReturn"
            label="Keep the bond this many days after the car comes back"
            hint="Time for late fines and tolls to arrive."
            value={settings.bondHoldDaysAfterReturn}
          />
          <ChoiceSettingForm
            setting="isRenterSignatureAtReturnRequired"
            label="Must the Renter sign when the car comes back?"
            value={choiceSettingValue(
              "isRenterSignatureAtReturnRequired",
              settings.isRenterSignatureAtReturnRequired,
            )}
          />
          <PhotoListForm photos={settings.handoverPhotos} />
          <NumberSettingForm
            setting="ongoingNoticeDays"
            label="Notice a Renter on an ongoing rental gives before returning the car (days)"
            value={settings.ongoingNoticeDays}
          />
        </CardContent>
      </Card>
      {isDemoDataAllowed() ? (
        <Card>
          <CardHeader>
            <CardTitle>Demo data</CardTitle>
            <CardDescription>
              Test site only: fill this business with made-up cars, Renters and rentals.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full sm:w-auto">
              <Link href={DEMO_DATA_PATH}>
                <DatabaseZap aria-hidden />
                Demo data
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </AppShell>
  );
}
