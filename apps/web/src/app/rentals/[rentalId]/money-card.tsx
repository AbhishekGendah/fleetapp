import { todayInTimeZone, type RentalStatus } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { FormDialog } from "@fleetapp/ui/form-dialog";
import { BadgePercent, Plus, ReceiptText, Undo2 } from "lucide-react";
import Link from "next/link";

import { CorrectionForm, ManualPaymentForm } from "../../../components/money-forms";
import { appDb } from "../../../lib/app-db";
import { listChargeTypes } from "../../../lib/ledger/charge-types";
import { isDailyRateWaivable } from "../../../lib/ledger/daily-rate-waiver";
import { chargeStart } from "../../../lib/ledger/ledger-input";
import { loadRentalLedger, type LedgerLineView } from "../../../lib/ledger/ledger-queries";
import { OPEN_FOR_MONEY } from "../../../lib/ledger/ledger-records";
import { manualPaymentStart } from "../../../lib/money/manual-payment-input";
import { renterMoneyPath } from "../../../lib/paths";
import type { RentalDetail } from "../../../lib/rentals/rental-queries";
import type { RentalClock } from "../../../lib/rentals/rental-records";
import type { SignedInUser } from "../../../lib/require-user";
import { LedgerSummary } from "../ledger-line-list";
import { ChargeForm } from "./charge-form";
import {
  addChargeAction,
  recordPaymentAction,
  reverseLineAction,
  waiveDailyRateAction,
} from "./money-actions";

/**
 * A draft has no money; a closed one is shown but not added to. A cancelled
 * booking is shown while it has lines, so its money is never stranded
 * (review A4-5): a payment can still be refunded and a charge reversed.
 */
const HAS_MONEY: ReadonlySet<RentalStatus> = new Set(["booked", "active", "returned", "closed"]);
/** The newest lines shown here; the Renter's Money tab has them all. */
const LINES_SHOWN = 8;

function ReverseButton({ rentalId, line }: { rentalId: string; line: LedgerLineView }) {
  return (
    <FormDialog
      triggerLabel="Reverse"
      title="Reverse this line"
      triggerIcon={<Undo2 aria-hidden />}
    >
      <CorrectionForm
        action={reverseLineAction.bind(null, rentalId, line.id)}
        label="Why is it being reversed?"
        hint="The Renter reads this on their statement. The line stays, cancelled out."
        submitLabel="Reverse this line"
      />
    </FormDialog>
  );
}

/**
 * The rental's money (rule 11): what is owing (always added up from the
 * lines), the newest lines, and adding a charge or recording a payment.
 * Rent is added by itself from the handover; mistakes are reversed, never
 * changed.
 */
export async function MoneyCard(props: {
  rental: RentalDetail;
  user: SignedInUser;
  clock: RentalClock;
}) {
  const { rental, user, clock } = props;
  const isCancelled = rental.status === "cancelled";
  if (!HAS_MONEY.has(rental.status) && !isCancelled) {
    return null;
  }
  const [ledger, chargeTypes] = await Promise.all([
    loadRentalLedger(appDb, user.operatorId, rental.id),
    listChargeTypes(appDb, user.operatorId),
  ]);
  if (isCancelled && ledger.lines.length === 0) {
    return null;
  }
  const today = todayInTimeZone(clock.now, clock.timeZone);
  const isOpen = OPEN_FOR_MONEY.has(rental.status);
  const usable = chargeTypes.filter((type) => !type.isArchived);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Money</CardTitle>
        <CardDescription>
          Rent is charged weekly in advance from the handover, by itself. Lines are never changed: a
          mistake is reversed.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <LedgerSummary
          ledger={ledger}
          label="Money lines"
          limit={LINES_SHOWN}
          actionsFor={(line) =>
            isOpen && ledger.reversibleIds.has(line.id) ? (
              <ReverseButton rentalId={rental.id} line={line} />
            ) : null
          }
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {isOpen ? (
            <>
              <FormDialog
                triggerLabel="Add charge"
                title="Add a charge"
                triggerIcon={<Plus aria-hidden />}
                isMainAction
              >
                <ChargeForm
                  action={addChargeAction.bind(null, rental.id, null)}
                  chargeTypes={usable}
                  initialValues={chargeStart({}, today)}
                />
              </FormDialog>
              <FormDialog
                triggerLabel="Record payment"
                title="Record a payment"
                triggerIcon={<ReceiptText aria-hidden />}
              >
                <ManualPaymentForm
                  action={recordPaymentAction.bind(null, rental.id)}
                  today={today}
                  initialValues={manualPaymentStart(Math.max(ledger.balanceCents, 0), today)}
                  submitLabel="Record payment"
                />
              </FormDialog>
            </>
          ) : null}
          {isDailyRateWaivable(rental) ? (
            <FormDialog
              triggerLabel="Waive the daily rate"
              title="Waive the daily rate"
              triggerIcon={<BadgePercent aria-hidden />}
            >
              <CorrectionForm
                action={waiveDailyRateAction.bind(null, rental.id)}
                label="Why is the daily rate waived?"
                hint="It came back before the long-term minimum, so it was re-priced at the daily rate. Waiving credits the difference. Kept for you; not shown to the Renter."
                submitLabel="Waive the daily rate"
              />
            </FormDialog>
          ) : null}
          {ledger.lines.length > LINES_SHOWN ? (
            <Button asChild variant="ghost">
              <Link href={renterMoneyPath(rental.renterId)}>See every line</Link>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
