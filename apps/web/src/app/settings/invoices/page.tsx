import type { Metadata } from "next";
import { DEFAULT_NUMBERING, documentNumberText, NUMBERING_SERIES_LABELS } from "@fleetapp/core";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { RequiredFieldsNote } from "@fleetapp/ui/input";
import { PageHeader } from "@fleetapp/ui/page-header";

import { appDb } from "../../../lib/app-db";
import { loadNumbering } from "../../../lib/billing/numbering";
import { SETTINGS_PATH } from "../../../lib/paths";
import { requireUser } from "../../../lib/require-user";
import { choiceSettingValue } from "../../../lib/settings/choice-setting-input";
import { loadOperatorSettings } from "../../../lib/settings/operator-settings";
import { AppShell } from "../../app-shell";
import { ChoiceSettingForm } from "../choice-setting-form";
import { saveHowToPayAction, saveNumberingAction } from "./actions";
import { HowToPayForm, NumberingForm } from "./invoice-setting-forms";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Invoices" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How invoices, credit notes and receipts are numbered, sent and what they say about paying. */
export default async function InvoiceSettingsPage() {
  const user = await requireUser();
  const [numbering, settings] = await Promise.all([
    loadNumbering(appDb, user.operatorId),
    loadOperatorSettings(appDb, user.operatorId),
  ]);

  return (
    <AppShell user={user}>
      <PageHeader backHref={SETTINGS_PATH} backLabel="Settings" title="Invoices" />
      <Card>
        <CardHeader>
          <CardTitle>Numbering</CardTitle>
          <CardDescription>
            Numbers run on in order with no gaps. Invoices and credit notes share one run; receipts
            have their own. Until the first is issued you can set where each starts, e.g.{" "}
            {documentNumberText(DEFAULT_NUMBERING.invoice)}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-8">
          <RequiredFieldsNote />
          {numbering.map((series) => (
            <section key={series.series} className="flex flex-col gap-4">
              <h2 className="font-semibold">{NUMBERING_SERIES_LABELS[series.series]}</h2>
              <NumberingForm
                action={saveNumberingAction.bind(null, series.series)}
                idPrefix={`${series.series}-`}
                prefix={series.prefix}
                nextNumber={series.nextNumber}
                isStarted={series.isStarted}
              />
            </section>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Sending</CardTitle>
          <CardDescription>
            Each invoice, credit note and receipt is a fixed PDF kept with the rental. A tax invoice
            when you are registered for GST (Settings → Business details).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-8">
          <ChoiceSettingForm
            setting="isInvoiceEmailedAutomatically"
            label="Email rent invoices, credit notes and receipts to the Renter as they are issued?"
            value={choiceSettingValue(
              "isInvoiceEmailedAutomatically",
              settings.isInvoiceEmailedAutomatically,
            )}
          />
          <section className="flex flex-col gap-1" aria-labelledby="one-off-invoices">
            <h2 id="one-off-invoices" className="font-semibold">
              One-off charges
            </h2>
            <p className="text-sm">
              Each one-off charge (cleaning, tolls, damage, a fee) is invoiced on its own as soon as
              you add it, and that invoice is always emailed to the Renter, or to a business&apos;s
              contact, whatever you choose above. If it is to be debited, the email says when and
              from which account, and nothing is debited before then (Settings → Payments).
            </p>
          </section>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>How to pay</CardTitle>
          <CardDescription>Printed under every invoice.</CardDescription>
        </CardHeader>
        <CardContent>
          <HowToPayForm action={saveHowToPayAction} howToPay={settings.howToPay} />
        </CardContent>
      </Card>
    </AppShell>
  );
}
