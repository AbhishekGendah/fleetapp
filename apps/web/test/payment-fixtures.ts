import type { TestConnection } from "@fleetapp/db/testing";
import type { EmailMessage } from "@fleetapp/email";

import type { ActingUser } from "../src/lib/acting-user";
import {
  handlePaymentEvent,
  refreshPaymentAccount,
  startStripeOnboarding,
  type PaymentEventResult,
} from "../src/lib/payments/payment-accounts";
import {
  sendPaymentsLink,
  type PaymentsLinkDependencies,
} from "../src/lib/payments/payments-links";
import { startRenterCheckout } from "../src/lib/payments/renter-checkout";
import type { SignedEvent, StandInPayments } from "../src/lib/payments/stand-in-provider";
import { emptyRenterForm, parseRenterForm } from "../src/lib/renters/renter-input";
import { createRenter } from "../src/lib/renters/renter-records";
import { openLink, type LinkVisit } from "../src/lib/renter-links/link-visits";
import { bookTestRental } from "./rental-fixtures";
import { recordingEmailSender } from "./renter-link-fixtures";

export const PAYMENTS_WEBHOOK_SECRET = "whsec_test_only";
export const PAYMENTS_APP_URL = "https://app.example.test";
export const PAYMENTS_ONBOARDING_URLS = {
  returnUrl: `${PAYMENTS_APP_URL}/settings/payments`,
  refreshUrl: `${PAYMENTS_APP_URL}/settings/payments/continue`,
};

/** A booked rental of a new Renter, ready for their payments link. */
export interface PaymentsTestRental {
  rentalId: string;
  renterId: string;
  vehicleId: string;
}

/** The steps a Renter's payments through Stripe's stand-in take, for one test file. */
export interface PaymentsTestKit {
  deps: (changes?: Partial<PaymentsLinkDependencies>) => PaymentsLinkDependencies;
  /** Stripe's message, as its webhook would bring it. */
  deliver: (event: SignedEvent) => Promise<PaymentEventResult>;
  connectStripe: (owner: ActingUser) => Promise<void>;
  bookedRental: (owner: ActingUser) => Promise<PaymentsTestRental>;
  /** The Operator sends the payments link; the Renter opens it. */
  openedPaymentsLink: (owner: ActingUser, rentalId: string) => Promise<LinkVisit>;
  /** The Renter opens Stripe's page from their link: its session id. */
  visitStripe: (visit: LinkVisit, purpose: "direct_debit" | "bond") => Promise<string>;
}

/**
 * The kit, reading the connection and the stand-in as each step runs, so it
 * can be made where a describe block's tests are and set up in beforeAll.
 */
export function paymentsTestKit(
  current: () => { web: TestConnection; stripe: StandInPayments },
  sentEmails: EmailMessage[] = [],
): PaymentsTestKit {
  const paymentDeps = () => ({
    database: current().web.db,
    payments: current().stripe,
    now: () => new Date(),
  });

  function deps(changes: Partial<PaymentsLinkDependencies> = {}): PaymentsLinkDependencies {
    return {
      ...paymentDeps(),
      emailSender: recordingEmailSender(sentEmails),
      appUrl: PAYMENTS_APP_URL,
      describeDay: (moment) => moment.toISOString().slice(0, 10),
      describeMoment: (moment) => moment.toISOString().slice(0, 16),
      canHearRenterPayments: true,
      ...changes,
    };
  }

  async function openedPaymentsLink(owner: ActingUser, rentalId: string): Promise<LinkVisit> {
    const sent = await sendPaymentsLink(deps(), owner, rentalId, "email");
    if (sent.status !== "sent") {
      throw new Error(sent.status);
    }
    return (await openLink(current().web.db, sent.url.split("/r/")[1]!))!;
  }

  return {
    deps,
    deliver: (event) => handlePaymentEvent(paymentDeps(), event.payload, event.signature),
    connectStripe: async (owner) => {
      await startStripeOnboarding(paymentDeps(), owner, PAYMENTS_ONBOARDING_URLS);
      await refreshPaymentAccount(paymentDeps(), owner.operatorId);
    },
    bookedRental: async (owner) => {
      const parsed = parseRenterForm(
        {
          ...emptyRenterForm(),
          fullName: "Pat Payer",
          email: "pat.payer@example.test",
          phone: "0412345678",
        },
        "2026-10-30",
      );
      const renterId = await createRenter(current().web.db, owner, parsed.data!);
      const { rentalId, vehicleId } = await bookTestRental(current().web, owner, renterId);
      return { rentalId, renterId, vehicleId };
    },
    openedPaymentsLink,
    visitStripe: async (visit, purpose) => {
      const started = await startRenterCheckout(deps(), visit, purpose);
      if (started.status !== "started") {
        throw new Error(started.status);
      }
      return started.url.split("/").at(-1)!;
    },
  };
}
