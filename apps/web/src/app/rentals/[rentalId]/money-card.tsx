import {
  DEBIT_COLLECTION_PLAN_LABELS,
  formatCents,
  formatDateTimeInTimeZone,
  todayInTimeZone,
  WEEKLY_DEBIT_PLANS,
  type RentalStatus,
} from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, SectionLabel } from "@fleetapp/ui/card";
import { FormDialog } from "@fleetapp/ui/form-dialog";
import { BadgePercent, Landmark, Plus, ReceiptText, Undo2 } from "lucide-react";
import Link from "next/link";

import { CorrectionForm, ManualPaymentForm } from "../../../components/money-forms";
import { appDb } from "../../../lib/app-db";
import {
  loadRentalDebitState,
  type ChargePlanRow,
  type RentalDebitState,
} from "../../../lib/debits/rental-debits";
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
import { CollectionForm } from "./collection-form";
import {
  addChargeAction,
  changeDebitPlanAction,
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

/** Whether the rental's money is shown at all (see HAS_MONEY). */
export function hasMoneyToShow(status: RentalStatus, lineCount: number): boolean {
  return HAS_MONEY.has(status) || (status === "cancelled" && lineCount > 0);
}
/** The newest lines shown here; the Renter's Money tab has them all. */
const LINES_SHOWN = 8;

/** Changing how a one-off charge is collected, while no part of it is debited yet. */
function CollectionButton(props: {
  rentalId: string;
  plan: ChargePlanRow;
  choices: RentalDebitState["choices"];
}) {
  return (
    <FormDialog
      triggerLabel="How it's collected"
      title="How this charge is collected"
      triggerIcon={<Landmark aria-hidden />}
    >
      <CollectionForm
        action={changeDebitPlanAction.bind(null, props.rentalId, props.plan.ledgerLineId)}
        choices={props.choices}
        current={props.plan}
      />
    </FormDialog>
  );
}

/**
 * The rental's debits in a few words (docs/plans/phase-4-slice-5.md): what
 * is on its way (never counted as paid), the last one that cleared, whether
 * automatic debits are paused, and the one-off charges waiting for one.
 */
function DebitSummary(props: {
  state: RentalDebitState;
  lines: readonly LedgerLineView[];
  timeZone: string;
}) {
  const { state, timeZone } = props;
  const waiting = state.plans.filter(
    (plan) =>
      WEEKLY_DEBIT_PLANS.has(plan.plan) &&
      plan.partsDebited < (plan.plan === "split" ? (plan.weeks ?? 0) : 1),
  );
  const descriptions = new Map(props.lines.map((line) => [line.id, line.description]));
  const notes = [
    state.pending
      ? `Debit of ${formatCents(state.pending.cents)} pending since ${formatDateTimeInTimeZone(state.pending.since, timeZone)}: not counted as paid until the bank clears it.`
      : null,
    state.lastCleared?.settledAt
      ? `Last debit ${formatCents(state.lastCleared.amountCents)} cleared on ${formatDateTimeInTimeZone(state.lastCleared.settledAt, timeZone)}.`
      : null,
    state.isPaused ? "Automatic debits paused." : null,
    ...waiting.map(
      (plan) =>
        `${descriptions.get(plan.ledgerLineId) ?? "A charge"}: ${DEBIT_COLLECTION_PLAN_LABELS[plan.plan].toLowerCase()}. Waiting for the next weekly debit.`,
    ),
  ].filter((note): note is string => note !== null);
  return notes.length > 0 ? (
    <ul className="flex flex-col gap-1 text-sm" aria-label="Direct debits">
      {notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  ) : null;
}

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
  if (!HAS_MONEY.has(rental.status) && rental.status !== "cancelled") {
    return null;
  }
  const [ledger, chargeTypes, debits] = await Promise.all([
    loadRentalLedger(appDb, user.operatorId, rental.id),
    listChargeTypes(appDb, user.operatorId),
    loadRentalDebitState(appDb, user.operatorId, rental),
  ]);
  const changeablePlans = new Map(
    debits.plans.filter((plan) => plan.partsDebited === 0).map((plan) => [plan.ledgerLineId, plan]),
  );
  if (!hasMoneyToShow(rental.status, ledger.lines.length)) {
    return null;
  }
  const today = todayInTimeZone(clock.now, clock.timeZone);
  const isOpen = OPEN_FOR_MONEY.has(rental.status);
  const usable = chargeTypes.filter((type) => !type.isArchived);
  return (
    <Card>
      <CardHeader>
        <SectionLabel>Charges and payments</SectionLabel>
        <CardDescription>
          Rent is charged weekly in advance from the handover, by itself. Lines are never changed: a
          mistake is reversed.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <LedgerSummary
          hasTotals
          ledger={ledger}
          label="Money lines"
          limit={LINES_SHOWN}
          actionsFor={(line) => {
            const plan = changeablePlans.get(line.id);
            const canReverse = isOpen && ledger.reversibleIds.has(line.id);
            const canChangePlan = plan !== undefined && debits.choices.length > 0;
            return canReverse || canChangePlan ? (
              <>
                {canReverse ? <ReverseButton rentalId={rental.id} line={line} /> : null}
                {canChangePlan ? (
                  <CollectionButton rentalId={rental.id} plan={plan} choices={debits.choices} />
                ) : null}
              </>
            ) : null;
          }}
        />
        <DebitSummary state={debits} lines={ledger.lines} timeZone={clock.timeZone} />
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
                  collectionChoices={debits.choices}
                  defaultCollection={debits.defaultCollection}
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
                  {...(debits.pending
                    ? {
                        warning: `A debit of ${formatCents(debits.pending.cents)} is on its way from the Renter's bank. Recording this as well may mean they pay twice; any overpayment stays as credit.`,
                      }
                    : {})}
                />
              </FormDialog>
            </>
          ) : null}
          {isDailyRateWaivable(rental, clock.now) ? (
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
