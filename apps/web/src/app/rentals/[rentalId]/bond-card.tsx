import {
  BOND_MOVEMENT_KIND_LABELS,
  bondHeldUntil,
  formatCalendarDate,
  formatCents,
  operatorSettingsSchema,
  PAYMENT_METHOD_LABELS,
  readSettings,
  todayInTimeZone,
} from "@fleetapp/core";
import { Badge } from "@fleetapp/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { FormDialog } from "@fleetapp/ui/form-dialog";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";
import { Plus, Undo2 } from "lucide-react";

import { DetailLines } from "../../../components/detail-lines";
import { appDb } from "../../../lib/app-db";
import {
  BOND_OPEN_STATUSES,
  loadBondAccount,
  type BondAccount,
  type BondMovementRow,
} from "../../../lib/bonds/bond-account";
import { bondReceivedStart } from "../../../lib/bonds/bond-input";
import type { RentalDetail } from "../../../lib/rentals/rental-queries";
import type { RentalClock } from "../../../lib/rentals/rental-records";
import type { SignedInUser } from "../../../lib/require-user";
import { recordBondReceivedAction, reverseBondMovementAction } from "./bond-actions";
import { CorrectionForm, ManualPaymentForm } from "../../../components/money-forms";

function entryTitle(movement: BondMovementRow): string {
  const kind = BOND_MOVEMENT_KIND_LABELS[movement.kind];
  return movement.method ? `${kind} · ${PAYMENT_METHOD_LABELS[movement.method]}` : kind;
}

function entryDetails(movement: BondMovementRow, account: BondAccount): React.ReactNode {
  const corrected = account.movements.find((other) => other.id === movement.reversesId);
  return (
    <>
      <span>{formatCalendarDate(movement.occurredOn)}</span>
      {movement.reference ? <span>Reference {movement.reference}</span> : null}
      {corrected ? (
        <span>
          Cancels the {BOND_MOVEMENT_KIND_LABELS[corrected.kind].toLowerCase()} entry of{" "}
          {formatCalendarDate(corrected.occurredOn)}
        </span>
      ) : null}
      {movement.note ? <span>Why: {movement.note}</span> : null}
    </>
  );
}

function BondEntries({ rentalId, account }: { rentalId: string; account: BondAccount }) {
  const correctedIds = new Set(account.movements.map((movement) => movement.reversesId));
  return (
    <RecordList label="Bond entries">
      {account.movements.map((movement) => (
        <RecordItem
          key={movement.id}
          title={entryTitle(movement)}
          aside={correctedIds.has(movement.id) ? <Badge>Corrected</Badge> : null}
          amount={formatCents(movement.amountCents)}
          details={entryDetails(movement, account)}
          actions={
            account.reversibleIds.has(movement.id) ? (
              <FormDialog
                triggerLabel="Correct"
                title="Correct this bond entry"
                triggerIcon={<Undo2 aria-hidden />}
              >
                <CorrectionForm
                  action={reverseBondMovementAction.bind(null, rentalId, movement.id)}
                  label="Why is it being corrected?"
                  hint="E.g. entered twice, or the wrong amount. The entry stays in the list, cancelled out."
                  submitLabel="Correct this entry"
                />
              </FormDialog>
            ) : null
          }
        />
      ))}
    </RecordList>
  );
}

/**
 * The rental's bond: what is required, held and still to receive (worked out
 * from the entries, never stored), every entry, and recording bond received
 * by bank transfer or cash. Card and direct debit come with Stripe.
 */
/** The bond is kept this long after the car came back, under the rental's own settings (rule 14). */
function heldUntil(rental: RentalDetail, returnedAt: Date, timeZone: string): string {
  const settings = readSettings(operatorSettingsSchema, rental.settingsSnapshot);
  return bondHeldUntil(returnedAt, settings.bondHoldDaysAfterReturn, timeZone);
}

export async function BondCard({
  rental,
  user,
  clock,
}: {
  rental: RentalDetail;
  user: SignedInUser;
  clock: RentalClock;
}) {
  const account = await loadBondAccount(appDb, user.operatorId, rental);
  if (rental.bondCents === 0 && account.movements.length === 0) {
    return null;
  }
  const today = todayInTimeZone(clock.now, clock.timeZone);
  const canReceive = BOND_OPEN_STATUSES.has(rental.status) && account.owingCents > 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bond</CardTitle>
        <CardDescription>
          Entries are never changed: a mistake is corrected by an entry that cancels it. No GST
          applies to a bond.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <DetailLines
          lines={[
            ["Required", formatCents(rental.bondCents)],
            ["Held now", formatCents(account.heldCents)],
            ["Still to receive", formatCents(account.owingCents)],
            ...(rental.returnedAt
              ? ([
                  [
                    "Held until",
                    formatCalendarDate(heldUntil(rental, rental.returnedAt, clock.timeZone)),
                  ],
                ] as const)
              : []),
          ]}
        />
        {account.movements.length > 0 ? (
          <BondEntries rentalId={rental.id} account={account} />
        ) : null}
        {canReceive ? (
          <FormDialog
            triggerLabel="Record bond received"
            title="Record bond received"
            triggerIcon={<Plus aria-hidden />}
            isMainAction
          >
            <ManualPaymentForm
              action={recordBondReceivedAction.bind(null, rental.id)}
              today={today}
              initialValues={bondReceivedStart(account.owingCents, today)}
              submitLabel="Record bond"
            />
          </FormDialog>
        ) : null}
      </CardContent>
    </Card>
  );
}
