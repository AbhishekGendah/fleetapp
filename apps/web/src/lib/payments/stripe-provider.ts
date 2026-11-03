import "server-only";

import { STRIPE_CAPABILITY_STATUSES, type StripeCapabilityStatus } from "@fleetapp/core";
import Stripe from "stripe";
import { z } from "zod";

import type { PaymentsProvider } from "./payments-provider";

/**
 * The Stripe API version the app is written against, the one its library
 * (23.0.0) was made for. Changed only together with the library, on
 * purpose, after reading Stripe's changelog.
 */
export const STRIPE_API_VERSION = "2026-09-30.endive";
/** The account country and currency: Australia only. */
const COUNTRY = "au";
const CURRENCY = "aud";
const ACCOUNT_DETAILS = ["configuration.merchant", "requirements"] as const;
/** v2.core.account.updated, v2.core.account[requirements].updated…: not account_link or account_person. */
const ACCOUNT_EVENT = /^v2\.core\.account[.[]/;

const capabilitySchema = z
  .object({ status: z.enum(STRIPE_CAPABILITY_STATUSES) })
  .optional()
  .transform((capability): StripeCapabilityStatus => capability?.status ?? "pending");

/** The parts of a v2 account the app reads; anything else Stripe sends is ignored. */
const accountSchema = z.object({
  id: z.string(),
  livemode: z.boolean(),
  configuration: z
    .object({
      merchant: z
        .object({
          capabilities: z
            .object({
              card_payments: capabilitySchema,
              au_becs_debit_payments: capabilitySchema,
            })
            .optional(),
        })
        .nullish(),
    })
    .nullish(),
  requirements: z
    .object({
      entries: z.array(z.object({ awaiting_action_from: z.string() })).optional(),
    })
    .nullish(),
});

/** Stripe itself, through its official library, on the AGS platform account. */
export function createStripeProvider(secretKey: string, webhookSecret: string): PaymentsProvider {
  const stripe = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
  return {
    async createAccount(account) {
      const created = accountSchema.parse(
        await stripe.v2.core.accounts.create(
          {
            display_name: account.businessName,
            ...(account.email ? { contact_email: account.email } : {}),
            dashboard: "full",
            identity: { country: COUNTRY },
            defaults: {
              currency: CURRENCY,
              // The business is the merchant: Stripe bills it, and it carries its own losses.
              responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
            },
            configuration: {
              merchant: {
                capabilities: {
                  card_payments: { requested: true },
                  au_becs_debit_payments: { requested: true },
                },
              },
            },
            metadata: { operator_id: account.operatorId },
          },
          // A double press, or a retry after a dropped connection, makes one account.
          { idempotencyKey: `connect-${account.operatorId}` },
        ),
      );
      return { accountId: created.id, isLive: created.livemode };
    },

    async onboardingLink(accountId, urls) {
      const link = await stripe.v2.core.accountLinks.create({
        account: accountId,
        use_case: {
          type: "account_onboarding",
          account_onboarding: { return_url: urls.returnUrl, refresh_url: urls.refreshUrl },
        },
      });
      return link.url;
    },

    async accountStatus(accountId) {
      const account = accountSchema.parse(
        await stripe.v2.core.accounts.retrieve(accountId, { include: [...ACCOUNT_DETAILS] }),
      );
      const capabilities = account.configuration?.merchant?.capabilities;
      return {
        cardPayments: capabilities?.card_payments ?? "pending",
        becsDebitPayments: capabilities?.au_becs_debit_payments ?? "pending",
        requirementsDue: (account.requirements?.entries ?? []).filter(
          (entry) => entry.awaiting_action_from === "user",
        ).length,
      };
    },

    async readEvent(payload, signature) {
      try {
        const notice = stripe.parseEventNotification(payload, signature, webhookSecret);
        const related = "related_object" in notice ? notice.related_object : undefined;
        // An account event names the account itself; any other names it as its context.
        const relatedId = related && "id" in related ? z.string().safeParse(related.id).data : null;
        const accountOfEvent = ACCOUNT_EVENT.test(notice.type) ? (relatedId ?? null) : null;
        // An event from a connected account carries that account as its context's last part.
        const contextAccount = notice.context?.segments.at(-1) ?? null;
        return { id: notice.id, type: notice.type, accountId: contextAccount ?? accountOfEvent };
      } catch (error) {
        if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
          return null;
        }
        throw error;
      }
    },
  };
}
