import {
  DIRECT_DEBIT_STATE_LABELS,
  formatCents,
  formatDateTimeInTimeZone,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  type DirectDebitState,
} from "@fleetapp/core";
import { Badge } from "@fleetapp/ui/badge";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";
import { Settings } from "lucide-react";
import Link from "next/link";

import { OnTheSpotLink } from "../../../components/on-the-spot-link";
import { RenterLinkSender } from "../../../components/renter-link-sender";
import { RenterLinkStatus } from "../../../components/renter-link-status";
import { appDb } from "../../../lib/app-db";
import { BOND_OPEN_STATUSES } from "../../../lib/bonds/bond-account";
import { appPaymentsLinkDependencies } from "../../../lib/payments/app-payments-links";
import { loadPaymentsLink } from "../../../lib/payments/payments-links";
import { isStripeOfferedToRenters } from "../../../lib/payments/renter-checkout";
import { loadRentalPayments } from "../../../lib/payments/renter-payment-records";
import { PAYMENT_SETTINGS_PATH } from "../../../lib/paths";
import type { RentalDetail } from "../../../lib/rentals/rental-queries";
import type { RentalClock } from "../../../lib/rentals/rental-records";
import type { SignedInUser } from "../../../lib/require-user";
import { emailPaymentsLinkAction, showPaymentsLinkAction } from "./payments-actions";

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

/**
 * The Renter's direct debit and the bond paid through Stripe, and the link
 * that gets them done: emailed, or shown as a code to scan on the spot.
 * The Renter always types their own details, on Stripe's page.
 */
export async function PaymentsCard(props: {
  rental: RentalDetail;
  user: SignedInUser;
  clock: RentalClock;
}) {
  const { rental, user, clock } = props;
  if (!BOND_OPEN_STATUSES.has(rental.status)) {
    return null;
  }
  const deps = appPaymentsLinkDependencies(user.operatorTimezone);
  if (!(await isStripeOfferedToRenters(deps, user.operatorId))) {
    return <NotOfferedCard isSiteReady={deps.canHearRenterPayments && deps.payments !== null} />;
  }
  const [payments, link] = await Promise.all([
    loadRentalPayments(appDb, user.operatorId, rental),
    loadPaymentsLink(appDb, user.operatorId, rental.id, clock.now),
  ]);
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
        <p className="flex flex-wrap items-center gap-2 text-sm">
          Direct debit:
          <Badge tone={STATE_TONES[payments.directDebit]}>
            {DIRECT_DEBIT_STATE_LABELS[payments.directDebit]}
          </Badge>
        </p>
        {payments.bond.toCollectCents > 0 ? (
          <p className="text-sm">Bond still to pay: {formatCents(payments.bond.toCollectCents)}.</p>
        ) : null}
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
                    <span>
                      {formatDateTimeInTimeZone(payment.createdAt, user.operatorTimezone)}
                    </span>
                  </>
                }
              />
            ))}
          </RecordList>
        ) : null}
        {link ? <RenterLinkStatus link={link} timeZone={user.operatorTimezone} /> : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <RenterLinkSender
            action={emailPaymentsLinkAction.bind(null, rental.id)}
            hasLink={link !== null}
            sendLabel="Email the link"
            urlFieldId="payments-link"
          />
          <OnTheSpotLink
            action={showPaymentsLinkAction.bind(null, rental.id)}
            label="Set up on the spot"
            instructions="They type the code we email them, then their own bank or card details on Stripe's page."
          />
        </div>
      </CardContent>
    </Card>
  );
}
