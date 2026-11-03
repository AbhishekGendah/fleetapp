import { describeErrorForLog } from "@fleetapp/core";
import { redirect } from "next/navigation";

import { appDb } from "../../../../lib/app-db";
import { appPayments } from "../../../../lib/payments/app-payments";
import { loadPaymentAccount } from "../../../../lib/payments/payment-accounts";
import { onboardingUrls } from "../../../../lib/payments/payment-urls";
import { PAYMENT_SETTINGS_PATH } from "../../../../lib/paths";
import { requireUser } from "../../../../lib/require-user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where Stripe sends the business when its onboarding link has expired or
 * been used: a fresh link for the account it already has. Never makes an
 * account (a link anyone could open must not change anything).
 */
export async function GET(): Promise<Response> {
  const user = await requireUser();
  const account = appPayments ? await loadPaymentAccount(appDb, user.operatorId) : null;
  if (!appPayments || !account) {
    redirect(PAYMENT_SETTINGS_PATH);
  }
  let url: string = PAYMENT_SETTINGS_PATH;
  try {
    url = await appPayments.onboardingLink(account.stripeAccountId, onboardingUrls());
  } catch (error) {
    console.error("Making a fresh Stripe onboarding link failed", describeErrorForLog(error));
  }
  redirect(url);
}
