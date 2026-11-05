import {
  DIRECT_DEBIT_STATE_LABELS,
  formatCents,
  formatDateTimeInTimeZone,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  type DirectDebitState,
} from "@fleetapp/core";
import { ActionButton } from "@fleetapp/ui/action-button";
import { Badge } from "@fleetapp/ui/badge";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";
import { Settings, XCircle } from "lucide-react";
import Link from "next/link";

import { LinkSendChoices } from "../../../components/link-send-choices";
import { RenterLinkStatus } from "../../../components/renter-link-status";
import { appDb } from "../../../lib/app-db";
import { BOND_OPEN_STATUSES } from "../../../lib/bonds/bond-account";
import { appPaymentsLinkDependencies } from "../../../lib/payments/app-payments-links";
import { loadPaymentsLink } from "../../../lib/payments/payments-links";
import { isStripeOfferedToRenters } from "../../../lib/payments/renter-checkout";
import {
  loadRentalPayments,
  type RentalPayments,
} from "../../../lib/payments/renter-payment-records";
import { PAYMENT_SETTINGS_PATH } from "../../../lib/paths";
import type { RentalDetail } from "../../../lib/rentals/rental-queries";
import type { RentalClock } from "../../../lib/rentals/rental-records";
import { NoBusinessEmailWarning } from "../../../components/no-business-email-warning";
import type { SignedInUser } from "../../../lib/require-user";
import {
  cancelPaymentsLinkAction,
  emailPaymentsLinkAction,
  showPaymentsLinkAction,
} from "./payments-actions";

const STATE_TONES: Readonly<Record<DirectDebitState, "good" | "attention" | "danger" | undefined>> =
  {
    active: "good",
    waiting: "attention",
    cancelled: "danger",
    not_set_up: undefined,
  };

function NotOfferedCard(props: { isSiteReady: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Direct debit and bond by Stripe</CardTitle>
        <CardDescription>
          {props.isSiteReady
            ? "Once your Stripe account is Ready, Renters set up their direct debit and pay the bond on Stripe's secure page."
            : "Renters cannot pay through Stripe on this site yet: it is still being switched on."}{" "}
          Until then, record cash and transfers by hand.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link href={PAYMENT_SETTINGS_PATH}>
            <Settings aria-hidden />
            Payments settings
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/** What Stripe has recorded for the rental: the Renter's direct debit and each payment. */
function PaymentRecords(props: { payments: RentalPayments; timeZone: string }) {
  const { payments, timeZone } = props;
  return (
    <>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        Direct debit:
        <Badge tone={STATE_TONES[payments.directDebit]}>
          {DIRECT_DEBIT_STATE_LABELS[payments.directDebit]}
        </Badge>
      </p>
      {payments.payments.length > 0 ? (
        <RecordList label="Payments through Stripe">
          {payments.payments.map((payment) => (
            <RecordItem
              key={payment.id}
              title={`Bond · ${PAYMENT_METHOD_LABELS[payment.method]}`}
              amount={formatCents(payment.amountCents)}
              details={
                <>
                  <span>{PAYMENT_STATUS_LABELS[payment.status]}</span>
                  <span>{formatDateTimeInTimeZone(payment.createdAt, timeZone)}</span>
                  {payment.takenBackCents > 0 ? (
                    <span>
                      {payment.isDisputed ? "Disputed by the Renter's bank: " : "Refunded: "}
                      {formatCents(payment.takenBackCents)}
                    </span>
                  ) : null}
                </>
              }
            />
          ))}
        </RecordList>
      ) : null}
    </>
  );
}

/** Sending the Renter the link that gets their direct debit and bond done, while Stripe is offered. */
async function PaymentsLinkActions(props: { rentalId: string; user: SignedInUser; now: Date }) {
  const link = await loadPaymentsLink(appDb, props.user.operatorId, props.rentalId, props.now);
  return (
    <>
      {link ? <RenterLinkStatus link={link} timeZone={props.user.operatorTimezone} /> : null}
      {link ? (
        <ActionButton
          action={cancelPaymentsLinkAction.bind(null, props.rentalId)}
          label="Cancel link"
          pendingLabel="Cancelling…"
          variant="outline"
          icon={<XCircle aria-hidden />}
        />
      ) : null}
      <NoBusinessEmailWarning user={props.user} />
      <LinkSendChoices
        emailAction={emailPaymentsLinkAction.bind(null, props.rentalId)}
        onTheSpotAction={showPaymentsLinkAction.bind(null, props.rentalId)}
        hasLink={link !== null}
        sendLabel="Email the link"
        urlFieldId="payments-link"
        onTheSpotLabel="Set up on the spot"
        onTheSpotInstructions="They type the code we email them, then their own bank or card details on Stripe's page."
      />
    </>
  );
}

/**
 * The Renter's direct debit and the bond paid through Stripe, and the link
 * that gets them done: emailed, or shown as a code to scan on the spot.
 * The Renter always types their own details, on Stripe's page. What Stripe
 * recorded always shows, even while Stripe re-checks the business's
 * account or once the rental is closed (review A5-7); only sending a new
 * link waits for both.
 */
export async function PaymentsCard(props: {
  rental: RentalDetail;
  user: SignedInUser;
  clock: RentalClock;
}) {
  const { rental, user, clock } = props;
  const isOpen = BOND_OPEN_STATUSES.has(rental.status);
  const deps = appPaymentsLinkDependencies(user.operatorTimezone);
  const [isOffered, payments] = await Promise.all([
    isStripeOfferedToRenters(deps, user.operatorId),
    loadRentalPayments(appDb, user.operatorId, rental),
  ]);
  const hasRecords = payments.payments.length > 0 || payments.directDebit !== "not_set_up";
  if (!hasRecords) {
    if (!isOpen) {
      return null;
    }
    if (!isOffered) {
      return <NotOfferedCard isSiteReady={deps.canHearRenterPayments && deps.payments !== null} />;
    }
  }
  const canSendLink = isOpen && isOffered;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Direct debit and bond by Stripe</CardTitle>
        <CardDescription>
          The Renter sets up their direct debit and pays the bond on Stripe&apos;s secure page. To
          change bank account, send the link again: the new direct debit replaces the old.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <PaymentRecords payments={payments} timeZone={user.operatorTimezone} />
        {isOpen && payments.bond.toCollectCents > 0 ? (
          <p className="text-sm">Bond still to pay: {formatCents(payments.bond.toCollectCents)}.</p>
        ) : null}
        {canSendLink ? (
          <PaymentsLinkActions rentalId={rental.id} user={user} now={clock.now} />
        ) : null}
        {isOpen && !isOffered ? (
          <p className="text-muted-foreground text-sm">
            Stripe isn&apos;t taking payments for you right now, so no new link can be sent. See
            Settings → Payments.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
