import {
  BANK_DEBIT_CLEARING_TEXT,
  bondPayableOnlineCents,
  formatCents,
  type DirectDebitState,
} from "@fleetapp/core";
import { CardDescription } from "@fleetapp/ui/card";
import { CircleCheck } from "lucide-react";

import { appDb } from "../../../lib/app-db";
import { appPaymentsLinkDependencies } from "../../../lib/payments/app-payments-links";
import {
  isStripeOfferedToRenters,
  loadPaymentsStep,
  recordReturnFromStripe,
} from "../../../lib/payments/renter-checkout";
import type { LinkVisit } from "../../../lib/renter-links/link-visits";
import { CheckoutButton } from "./checkout-button";
import { RefreshWhileWaiting } from "./refresh-while-waiting";
import { RememberLink } from "./remember-link";

function Done(props: { children: React.ReactNode }) {
  return (
    <p className="text-teal flex items-start gap-2 text-sm font-medium">
      <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{props.children}</span>
    </p>
  );
}

function StepHeading(props: { children: React.ReactNode }) {
  return <h2 className="text-base font-semibold">{props.children}</h2>;
}

function DirectDebitStep(props: {
  token: string;
  state: DirectDebitState;
  operatorName: string;
  canPay: boolean;
}) {
  if (props.state === "active") {
    return (
      <section className="flex flex-col gap-2">
        <StepHeading>1. Direct debit</StepHeading>
        <Done>Your direct debit is set up.</Done>
        {props.canPay ? (
          <CheckoutButton
            token={props.token}
            purpose="direct_debit"
            label="Change bank account"
            variant="outline"
          />
        ) : null}
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-2">
      <StepHeading>1. Set up your direct debit</StepHeading>
      {props.state === "waiting" ? (
        <p className="text-sm">Stripe is checking your bank account. This page updates itself.</p>
      ) : (
        <p className="text-sm">
          {props.state === "cancelled"
            ? "Your bank cancelled your last direct debit. Please set up a new one."
            : `Your rent is taken weekly from your bank account by direct debit for ${props.operatorName}.`}{" "}
          You enter your bank details and accept the Direct Debit Request on Stripe&apos;s secure
          page.
        </p>
      )}
      {props.canPay ? (
        <CheckoutButton token={props.token} purpose="direct_debit" label="Set up direct debit" />
      ) : null}
    </section>
  );
}

function BondStep(props: {
  token: string;
  operatorName: string;
  canPay: boolean;
  bond: { requiredCents: number; heldCents: number; pendingCents: number; toCollectCents: number };
}) {
  const { bond } = props;
  if (bond.requiredCents === 0) {
    return null;
  }
  return (
    <section className="flex flex-col gap-2">
      <StepHeading>2. Pay your bond</StepHeading>
      {bond.toCollectCents === 0 && bond.pendingCents === 0 ? (
        <Done>Your bond of {formatCents(bond.requiredCents)} is paid.</Done>
      ) : null}
      {bond.pendingCents > 0 ? (
        <p className="text-sm">
          {formatCents(bond.pendingCents)} is on its way from your bank. It can take{" "}
          {BANK_DEBIT_CLEARING_TEXT} to clear.
        </p>
      ) : null}
      {bond.toCollectCents > 0 && bondPayableOnlineCents(bond.toCollectCents) === 0 ? (
        <p className="text-sm">
          {formatCents(bond.toCollectCents)} is still owing: too little to pay online.{" "}
          {props.operatorName} will sort it out with you.
        </p>
      ) : null}
      {props.canPay && bondPayableOnlineCents(bond.toCollectCents) > 0 ? (
        <>
          <p className="text-sm">
            Still to pay: {formatCents(bond.toCollectCents)}. Pay by card, or from your bank account
            (that takes {BANK_DEBIT_CLEARING_TEXT} to clear).
          </p>
          <CheckoutButton
            token={props.token}
            purpose="bond"
            label={`Pay ${formatCents(bond.toCollectCents)} bond`}
          />
        </>
      ) : null}
    </section>
  );
}

/**
 * The Renter's payments link (slice 4): set up the direct debit, then pay
 * the bond if it is still owing, each on Stripe's own page. Their bank and
 * card details go to Stripe only (rule 7). Comes back here from Stripe.
 */
export async function PaymentsStep(props: {
  token: string;
  visit: LinkVisit;
  isBackFromStripe: boolean;
}) {
  const { visit } = props;
  const deps = appPaymentsLinkDependencies(visit.timeZone);
  if (props.isBackFromStripe) {
    // Recorded now, so this page never offers to pay what was just paid (review KS-1).
    await recordReturnFromStripe(deps, visit);
  }
  const [stripe, payments] = await Promise.all([
    isStripeOfferedToRenters(deps, visit.operatorId),
    loadPaymentsStep(appDb, visit),
  ]);
  if (!payments) {
    return (
      <CardDescription>
        This rental is closed, so there is nothing to pay here. Ask {visit.operatorName} if you have
        a question.
      </CardDescription>
    );
  }
  const isOffered = stripe !== null;
  const isWaiting = payments.directDebit === "waiting" || payments.bond.pendingCents > 0;
  return (
    <div className="flex flex-col gap-6">
      <RememberLink />
      {isWaiting ? <RefreshWhileWaiting /> : null}
      {props.isBackFromStripe && isWaiting ? (
        <p role="status" className="bg-muted rounded-md p-3 text-sm">
          Thanks. Stripe is confirming it with us; this page updates in a few seconds.
        </p>
      ) : null}
      {isOffered ? null : (
        <CardDescription>
          Payments are not being taken online right now. {visit.operatorName} will tell you how to
          pay.
        </CardDescription>
      )}
      <DirectDebitStep
        token={props.token}
        state={payments.directDebit}
        operatorName={visit.operatorName}
        canPay={isOffered}
      />
      <BondStep
        token={props.token}
        operatorName={visit.operatorName}
        bond={payments.bond}
        canPay={isOffered}
      />
      <p className="text-muted-foreground text-xs">
        Your bank and card details go to Stripe, the payment company {visit.operatorName} uses,
        which keeps them in Australia and overseas. {visit.operatorName} can see only the last
        digits of your account or card. Nobody can take money with what they see.
      </p>
    </div>
  );
}
