import "server-only";

import {
  CHECKOUT_PURPOSES,
  STRIPE_CAPABILITY_STATUSES,
  type PaymentAccountStatus,
  type StripeCapabilityStatus,
} from "@fleetapp/core";
import Stripe from "stripe";
import { z } from "zod";

import type { CheckoutOutcome, CheckoutReference, PaymentsProvider } from "./payments-provider";

/**
 * The Stripe API version the app is written against, the one its library
 * (23.0.0) was made for. Changed only together with the library, on
 * purpose, after reading Stripe's changelog.
 */
export const STRIPE_API_VERSION = "2026-09-30.endive";
/** The account country and currency: Australia only. */
const COUNTRY = "au";
const MILLISECONDS_PER_SECOND = 1000;
/** What Stripe says when asked to detach a bank account that is no longer attached. */
const ALREADY_DETACHED_CODES: ReadonlySet<string> = new Set([
  "payment_method_unexpected_state",
  "resource_missing",
]);
const CURRENCY = "aud";
const ACCOUNT_DETAILS = ["configuration.merchant", "requirements"] as const;
/** v2.core.account.updated, v2.core.account[requirements].updated…: not account_link or account_person. */
const ACCOUNT_EVENT = /^v2\.core\.account[.[]/;

/**
 * Stripe marks a capability restricted while it is still checking details
 * just given; that is waiting, not a limit, so it reads as pending.
 */
const STILL_CHECKING = new Set(["determining_status", "requirements_pending_verification"]);

const capabilitySchema = z
  .object({
    status: z.enum(STRIPE_CAPABILITY_STATUSES),
    status_details: z.array(z.object({ code: z.string() })).optional(),
  })
  .optional()
  .transform((capability): StripeCapabilityStatus => {
    if (!capability) {
      return "pending";
    }
    const details = capability.status_details ?? [];
    const isOnlyChecking =
      capability.status === "restricted" &&
      details.length > 0 &&
      details.every((detail) => STILL_CHECKING.has(detail.code));
    return isOnlyChecking ? "pending" : capability.status;
  });

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
  /** Stripe closed the account (v2.core.account.closed). */
  closed: z.boolean().nullish(),
  requirements: z
    .object({
      entries: z
        .array(
          z.object({
            awaiting_action_from: z.string(),
            minimum_deadline: z.object({ status: z.string() }).nullish(),
          }),
        )
        .optional(),
    })
    .nullish(),
});

/** Requirements that switch payments off if left: due now, or already overdue (review A5-1). */
const DUE_NOW = new Set(["currently_due", "past_due"]);

/** What a v2 account, as Stripe returns it, says the business can do. */
export function accountStatusOf(raw: unknown): PaymentAccountStatus {
  const account = accountSchema.parse(raw);
  const capabilities = account.configuration?.merchant?.capabilities;
  const forTheBusiness = (account.requirements?.entries ?? []).filter(
    (entry) => entry.awaiting_action_from === "user",
  );
  // An entry with no deadline status is treated as due now: never as nothing to do.
  const dueNow = forTheBusiness.filter(
    (entry) => !entry.minimum_deadline || DUE_NOW.has(entry.minimum_deadline.status),
  ).length;
  return {
    cardPayments: capabilities?.card_payments ?? "pending",
    becsDebitPayments: capabilities?.au_becs_debit_payments ?? "pending",
    requirementsDue: dueNow,
    requirementsLater: forTheBusiness.length - dueNow,
    isDisconnected: account.closed === true,
  };
}

/** The thin event, if its signature is Stripe's for one of our event destinations; null if not. */
function noticeFor(
  stripe: Stripe,
  payload: string,
  signature: string,
  webhookSecrets: readonly string[],
): ReturnType<Stripe["parseEventNotification"]> | null {
  for (const secret of webhookSecrets) {
    try {
      return stripe.parseEventNotification(payload, signature, secret);
    } catch (error) {
      if (!(error instanceof Stripe.errors.StripeSignatureVerificationError)) {
        throw error;
      }
    }
  }
  return null;
}

function metadataOf(reference: CheckoutReference): Record<string, string> {
  return {
    purpose: reference.purpose,
    rental_id: reference.rentalId,
    renter_id: reference.renterId,
    link_id: reference.linkId,
  };
}

const referenceSchema = z.object({
  purpose: z.enum(CHECKOUT_PURPOSES),
  rental_id: z.uuid(),
  renter_id: z.uuid(),
  link_id: z.uuid(),
});

/** What a session is for, as we told Stripe; null if its metadata is not ours. */
function referenceOf(metadata: unknown): CheckoutReference | null {
  const parsed = referenceSchema.safeParse(metadata);
  return parsed.success
    ? {
        purpose: parsed.data.purpose,
        rentalId: parsed.data.rental_id,
        renterId: parsed.data.renter_id,
        linkId: parsed.data.link_id,
      }
    : null;
}

const STRIPE_METHOD_TYPES = { card: "card", au_becs_debit: "becs_debit" } as const;
const INTENT_OUTCOMES: Readonly<Record<string, "paid" | "processing">> = {
  succeeded: "paid",
  processing: "processing",
};

/** The parts of a Checkout session (with its intents expanded) the app reads. */
const sessionSchema = z.object({
  id: z.string(),
  status: z.string().nullable(),
  metadata: z.record(z.string(), z.string()).nullable(),
  setup_intent: z
    .object({
      id: z.string(),
      /** Seconds since 1970, as Stripe gives times. */
      created: z.number().int(),
      payment_method: z.string().nullable(),
      mandate: z.string().nullable(),
    })
    .nullable(),
  payment_intent: z
    .object({
      id: z.string(),
      status: z.string(),
      amount: z.number().int(),
      payment_method: z.object({ type: z.string() }).nullable(),
      last_payment_error: z.object({ code: z.string().optional() }).nullable(),
    })
    .nullable(),
});

/** A payment's method, amount and whether the money is in, or null if it is not one we take. */
function paymentOf(
  intent: z.infer<typeof sessionSchema>["payment_intent"],
): CheckoutOutcome["payment"] {
  const type = intent?.payment_method?.type;
  if (!intent || (type !== "card" && type !== "au_becs_debit")) {
    return null;
  }
  // Anything else, once Stripe's page is finished with it, did not go through.
  const status = INTENT_OUTCOMES[intent.status] ?? "failed";
  return {
    paymentIntentId: intent.id,
    method: STRIPE_METHOD_TYPES[type],
    amountCents: intent.amount,
    status,
    failureCode: status === "failed" ? (intent.last_payment_error?.code ?? null) : null,
  };
}

/**
 * What came of a visit to Stripe's page, from the session as Stripe returns
 * it (its intents expanded) and its mandate's status, if one was set up.
 */
export function checkoutOutcomeOf(raw: unknown, mandateStatus: string | null): CheckoutOutcome {
  const session = sessionSchema.parse(raw);
  const setupIntent = session.setup_intent;
  return {
    sessionId: session.id,
    reference: referenceOf(session.metadata),
    isComplete: session.status === "complete",
    isExpired: session.status === "expired",
    setup:
      setupIntent?.mandate && setupIntent.payment_method && mandateStatus
        ? {
            setupIntentId: setupIntent.id,
            paymentMethodId: setupIntent.payment_method,
            mandateId: setupIntent.mandate,
            mandateStatus,
            setUpAt: new Date(setupIntent.created * MILLISECONDS_PER_SECOND),
          }
        : null,
    payment: paymentOf(session.payment_intent),
  };
}

/** Stripe itself, through its official library, on the AGS platform account. */
export function createStripeProvider(
  secretKey: string,
  webhookSecrets: readonly string[],
): PaymentsProvider {
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
      return accountStatusOf(
        await stripe.v2.core.accounts.retrieve(accountId, { include: [...ACCOUNT_DETAILS] }),
      );
    },

    async readEvent(payload, signature) {
      const notice = noticeFor(stripe, payload, signature, webhookSecrets);
      if (!notice) {
        return null;
      }
      const related = "related_object" in notice ? notice.related_object : undefined;
      // An account event names the account itself; any other names it as its context.
      const relatedId = related && "id" in related ? z.string().safeParse(related.id).data : null;
      const accountOfEvent = ACCOUNT_EVENT.test(notice.type) ? (relatedId ?? null) : null;
      // An event from a connected account carries that account as its context's last part.
      const contextAccount = notice.context?.segments.at(-1) ?? null;
      return {
        id: notice.id,
        type: notice.type,
        accountId: contextAccount ?? accountOfEvent,
        objectId: relatedId ?? null,
        occurredAt: new Date(notice.created),
      };
    },

    async createCustomer(accountId, customer) {
      const created = await stripe.customers.create(
        {
          name: customer.name,
          ...(customer.email ? { email: customer.email } : {}),
          metadata: { renter_id: customer.renterId },
        },
        // A retry after a dropped connection makes one customer for the Renter.
        { stripeAccount: accountId, idempotencyKey: `customer-${customer.renterId}` },
      );
      return created.id;
    },

    async startCheckout(accountId, request) {
      const metadata = metadataOf(request.reference);
      const shared = {
        customer: request.customerId,
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
        metadata,
        locale: "en" as const,
        expires_at: Math.floor(request.expiresAt.getTime() / MILLISECONDS_PER_SECOND),
      };
      const session = request.payment
        ? await stripe.checkout.sessions.create(
            {
              ...shared,
              mode: "payment",
              allowed_payment_method_types: ["card", "au_becs_debit"],
              line_items: [
                {
                  quantity: 1,
                  price_data: {
                    currency: CURRENCY,
                    unit_amount: request.payment.amountCents,
                    product_data: { name: request.payment.description },
                  },
                },
              ],
              payment_intent_data: { metadata, description: request.payment.description },
            },
            { stripeAccount: accountId },
          )
        : await stripe.checkout.sessions.create(
            {
              ...shared,
              mode: "setup",
              currency: CURRENCY,
              allowed_payment_method_types: ["au_becs_debit"],
              setup_intent_data: { metadata },
            },
            { stripeAccount: accountId },
          );
      if (!session.url) {
        throw new Error("Stripe gave no address for its page.");
      }
      return { sessionId: session.id, url: session.url };
    },

    async expireCheckout(accountId, sessionId) {
      try {
        await stripe.checkout.sessions.expire(sessionId, {}, { stripeAccount: accountId });
      } catch (error) {
        // Stripe refuses to expire a page already finished or expired; the caller reads which.
        if (!(error instanceof Stripe.errors.StripeInvalidRequestError)) {
          throw error;
        }
      }
    },

    async readCheckout(accountId, sessionId) {
      const raw = await stripe.checkout.sessions.retrieve(
        sessionId,
        { expand: ["setup_intent", "payment_intent", "payment_intent.payment_method"] },
        { stripeAccount: accountId },
      );
      const setupIntent = sessionSchema.parse(raw).setup_intent;
      const mandateStatus =
        setupIntent?.mandate && setupIntent.payment_method
          ? (await stripe.mandates.retrieve(setupIntent.mandate, {}, { stripeAccount: accountId }))
              .status
          : null;
      return checkoutOutcomeOf(raw, mandateStatus);
    },

    async readMandateStatus(accountId, mandateId) {
      const mandate = await stripe.mandates.retrieve(mandateId, {}, { stripeAccount: accountId });
      return mandate.status;
    },

    async detachPaymentMethod(accountId, paymentMethodId) {
      try {
        await stripe.paymentMethods.detach(paymentMethodId, {}, { stripeAccount: accountId });
      } catch (error) {
        const isAlreadyDone =
          error instanceof Stripe.errors.StripeInvalidRequestError &&
          error.code !== undefined &&
          ALREADY_DETACHED_CODES.has(error.code);
        if (!isAlreadyDone) {
          throw error;
        }
      }
    },
  };
}
