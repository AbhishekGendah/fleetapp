import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type { PaymentAccountStatus } from "@fleetapp/core";
import { z } from "zod";

import type { PaymentsProvider } from "./payments-provider";

/**
 * Stripe's stand-in for tests and the browser tests (decision 6): accounts
 * kept in memory, onboarding that finishes at once, and events signed with
 * the endpoint's secret the way the tests send them. Never used in
 * production: the app refuses to start with it there.
 */
export interface StandInPayments extends PaymentsProvider {
  /** Sets what "Stripe" says about an account, as a test needs. */
  setStatus(accountId: string, status: PaymentAccountStatus): void;
  /** A test's event, signed as the endpoint expects. */
  signedEvent(event: { id: string; type: string; accountId: string | null }): {
    payload: string;
    signature: string;
  };
}

const READY: PaymentAccountStatus = {
  cardPayments: "active",
  becsDebitPayments: "active",
  requirementsDue: 0,
};
const JUST_MADE: PaymentAccountStatus = {
  cardPayments: "pending",
  becsDebitPayments: "pending",
  requirementsDue: 1,
};

const standInEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  accountId: z.string().nullable(),
});

function signatureOf(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function createStandInPayments(webhookSecret: string): StandInPayments {
  const accounts = new Map<string, PaymentAccountStatus>();
  const madeFor = new Map<string, string>();
  return {
    async createAccount(account) {
      const existing = madeFor.get(account.operatorId);
      const accountId = existing ?? `acct_standin${randomUUID().replaceAll("-", "")}`;
      if (!existing) {
        madeFor.set(account.operatorId, accountId);
        accounts.set(accountId, JUST_MADE);
      }
      return { accountId, isLive: false };
    },
    async onboardingLink(accountId, urls) {
      // Stripe's pages are skipped: the business comes straight back, its details given.
      accounts.set(accountId, READY);
      return urls.returnUrl;
    },
    async accountStatus(accountId) {
      return accounts.get(accountId) ?? JUST_MADE;
    },
    async readEvent(payload, signature) {
      const expected = Buffer.from(signatureOf(webhookSecret, payload));
      const given = Buffer.from(signature);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
        return null;
      }
      return standInEventSchema.parse(JSON.parse(payload));
    },
    setStatus(accountId, status) {
      accounts.set(accountId, status);
    },
    signedEvent(event) {
      const payload = JSON.stringify(event);
      return { payload, signature: signatureOf(webhookSecret, payload) };
    },
  };
}
