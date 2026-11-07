import type { Metadata } from "next";
import {
  describeErrorForLog,
  PAYMENT_ACCOUNT_STATE_LABELS,
  type PaymentAccountState,
} from "@fleetapp/core";
import { ActionButton } from "@fleetapp/ui/action-button";
import { Badge, type BadgeTone } from "@fleetapp/ui/badge";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { RequiredFieldsNote } from "@fleetapp/ui/input";
import { PageHeader } from "@fleetapp/ui/page-header";
import { ExternalLink, Landmark } from "lucide-react";

import { appDb } from "../../../lib/app-db";
import { appPayments } from "../../../lib/payments/app-payments";
import {
  loadPaymentAccount,
  refreshPaymentAccount,
  type PaymentAccountView,
} from "../../../lib/payments/payment-accounts";
import { SETTINGS_PATH } from "../../../lib/paths";
import { requireUser } from "../../../lib/require-user";
import { loadOperatorSettings } from "../../../lib/settings/operator-settings";
import { AppShell } from "../../app-shell";
import { NumberSettingForm } from "../number-setting-form";
import { connectStripeAction } from "./actions";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Payments" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stripe's own dashboard, where the business runs its account (decision 1). */
const STRIPE_DASHBOARD_URL = "https://dashboard.stripe.com";

const STATE_TONES: Readonly<Record<PaymentAccountState, BadgeTone>> = {
  not_connected: "neutral",
  details_needed: "attention",
  in_review: "attention",
  ready: "good",
  restricted: "danger",
  disconnected: "danger",
};

const STATE_HELP: Readonly<Record<PaymentAccountState, string>> = {
  not_connected:
    "Connect your own Stripe account so Renters can pay you by direct debit and card. Stripe asks for your business, bank and ID details on its own pages; they go to Stripe, not to us.",
  details_needed:
    "Stripe still needs some details from you before it can take payments. Continue where you left off.",
  in_review: "Stripe is checking the details you gave. This usually takes a day or two.",
  ready:
    "Stripe can take payments for you. Ask Stripe to raise your direct debit limits: new accounts start low.",
  restricted:
    "Stripe has limited what this account can do. Open your Stripe dashboard to see why and what it needs.",
  disconnected:
    "This Stripe account was closed or disconnected from us, so Renters are not offered Stripe's page. Contact us to connect a different account.",
};

/**
 * Asks Stripe for the account's latest state on each visit; if Stripe
 * can't be reached, what it last said. A disconnected account is not asked:
 * Stripe no longer lets us read it.
 */
async function currentAccount(operatorId: string): Promise<PaymentAccountView | null> {
  const account = await loadPaymentAccount(appDb, operatorId);
  if (!account || !appPayments || account.state === "disconnected") {
    return account;
  }
  try {
    await refreshPaymentAccount(
      { database: appDb, payments: appPayments, now: () => new Date() },
      operatorId,
    );
    return await loadPaymentAccount(appDb, operatorId);
  } catch (error) {
    console.error("Reading a Stripe account's state failed", describeErrorForLog(error));
    return account;
  }
}

/** What Stripe will want only once the business grows: noted, never switching payments off (review A5-1). */
function laterRequirementsText(count: number): string {
  return `Stripe will want ${count === 1 ? "one more detail" : `${count} more details`} from you later, once your business takes more. Payments keep working until then; Stripe will email you.`;
}

/** The business's own Stripe account: connecting it, and what Stripe says it can do. */
export default async function PaymentSettingsPage() {
  const user = await requireUser();
  const [account, settings] = await Promise.all([
    currentAccount(user.operatorId),
    loadOperatorSettings(appDb, user.operatorId),
  ]);
  const state = account?.state ?? "not_connected";
  const isConnected = state !== "not_connected";
  const laterCount = state === "ready" ? (account?.status.requirementsLater ?? 0) : 0;

  return (
    <AppShell user={user}>
      <PageHeader backHref={SETTINGS_PATH} backLabel="Settings" title="Payments" />
      <Card>
        <CardHeader>
          <CardTitle>Stripe</CardTitle>
          <CardDescription>
            Your business takes payments through its own Stripe account: your name is on the
            Renter&apos;s bank statement, and Stripe&apos;s fees are billed to you. Until it is
            ready, record cash and bank transfers on each rental as now.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {appPayments ? (
            <>
              <div>
                <Badge tone={STATE_TONES[state]}>{PAYMENT_ACCOUNT_STATE_LABELS[state]}</Badge>
              </div>
              <p className="text-sm">{STATE_HELP[state]}</p>
              {laterCount > 0 ? (
                <p className="text-muted-foreground text-sm">{laterRequirementsText(laterCount)}</p>
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {state === "ready" || state === "disconnected" ? null : (
                  <ActionButton
                    action={connectStripeAction}
                    label={isConnected ? "Continue with Stripe" : "Connect Stripe"}
                    pendingLabel="Opening Stripe…"
                    variant="default"
                    icon={<Landmark aria-hidden />}
                  />
                )}
                {isConnected ? (
                  <Button asChild variant="outline">
                    <a href={STRIPE_DASHBOARD_URL} target="_blank" rel="noreferrer">
                      <ExternalLink aria-hidden />
                      Open your Stripe dashboard
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  </Button>
                ) : null}
              </div>
            </>
          ) : (
            <p className="text-sm">
              Payments by Stripe are not set up on this site yet. Record cash and bank transfers on
              each rental as now.
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Overdue</CardTitle>
          <CardDescription>
            When money still owing shows as Overdue in Needs attention, so you know who to follow
            up. Nothing is charged or sent to the Renter.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <RequiredFieldsNote />
          <NumberSettingForm
            setting="paymentGraceDays"
            label="Count as overdue after this many days"
            hint="Days after a charge was due. 0 counts it overdue the day after."
            value={settings.paymentGraceDays}
          />
        </CardContent>
      </Card>
    </AppShell>
  );
}
