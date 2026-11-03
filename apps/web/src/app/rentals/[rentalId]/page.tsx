import {
  formatCents,
  formatDateTimeInTimeZone,
  isHandoverAllowed,
  isRecordId,
  RENTAL_TYPE_LABELS,
  renterDisplayName,
  WEEKDAY_LABELS,
  type Weekday,
} from "@fleetapp/core";
import { ACTIVITY_ENTITY_TYPES } from "@fleetapp/db/schema";
import { ActionButton } from "@fleetapp/ui/action-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { FormDialog } from "@fleetapp/ui/form-dialog";
import { PageHeader } from "@fleetapp/ui/page-header";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";
import { TabLinks } from "@fleetapp/ui/tab-links";
import { CalendarCheck, CircleX, History, ReceiptText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DetailLines } from "../../../components/detail-lines";
import { HistoryCard } from "../../../components/history-card";
import { appDb } from "../../../lib/app-db";
import { loadBondAccount } from "../../../lib/bonds/bond-account";
import { carPath, rentalPath, RENTALS_PATH, renterPath } from "../../../lib/paths";
import { recordTabs, TAB_PARAM, type RecordTab } from "../../../lib/record-tabs";
import { loadRentalProblems } from "../../../lib/rentals/booking-checks";
import { bookingProblemMessage } from "../../../lib/rentals/rental-messages";
import {
  describeRateStart,
  describeRentalValue,
  rentalFieldLabel,
} from "../../../lib/rentals/rental-labels";
import { loadRental, type RentalDetail } from "../../../lib/rentals/rental-queries";
import type { RentalClock } from "../../../lib/rentals/rental-records";
import { requireUser, type SignedInUser } from "../../../lib/require-user";
import { AppShell } from "../../app-shell";
import { RentalBadges } from "../rental-status-badge";
import { bookDraftAction, cancelRentalAction } from "./actions";
import { CancelRentalForm } from "./cancel-form";
import { BondCard } from "./bond-card";
import { ChangesCard } from "./changes-card";
import { ContractCard } from "./contract-card";
import { MoneyCard } from "./money-card";
import { HandoverCard, ReturnCard } from "./handover-card";
import { SwapCard } from "./swap-card";
import { DamageList } from "../../cars/damage-list";
import { listRentalDamage } from "../../../lib/damage/damage-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TABS = [
  { key: "summary", label: "Summary", icon: ReceiptText },
  { key: "log", label: "Log", icon: History },
] as const satisfies readonly [RecordTab, ...RecordTab[]];
const TAB_LINKS = recordTabs(TABS, rentalPath);
/** A draft or a booking can still be cancelled; after handover it is returned instead. */
const CANCELLABLE = new Set(["draft", "booked"]);

function SummaryCard({ rental, timeZone }: { rental: RentalDetail; timeZone: string }) {
  const onClock = (moment: Date) => formatDateTimeInTimeZone(moment, timeZone);
  const lines: [string, React.ReactNode][] = [
    [
      "Renter",
      <Link key="renter" href={renterPath(rental.renterId)} className="text-teal underline">
        {renterDisplayName(rental.renterFullName, rental.renterPreferredName)}
      </Link>,
    ],
    [
      "Car",
      <Link key="car" href={carPath(rental.vehicleId)} className="text-teal underline">
        {rental.rego} · {rental.make} {rental.model}
      </Link>,
    ],
    ["Kind", RENTAL_TYPE_LABELS[rental.type]],
    ["Starts", onClock(rental.plannedStart)],
    ["Ends", rental.plannedEnd ? onClock(rental.plannedEnd) : "No end date yet (ongoing)"],
    ["Weekly rate", formatCents(rental.weeklyRateCents)],
    ["Bond", formatCents(rental.bondCents)],
    ["Rent charged each", WEEKDAY_LABELS[rental.chargeWeekday as Weekday]],
    ["Notes", rental.notes ?? "None"],
  ];
  if (rental.cancellationReason) {
    lines.push(["Why it was cancelled", rental.cancellationReason]);
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rental</CardTitle>
        <CardDescription>
          Made with your settings as they were then (version {rental.settingsVersion}). Later
          changes to Settings do not apply to it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DetailLines lines={lines} />
      </CardContent>
    </Card>
  );
}

/** Only a rental not yet handed over has anything to check before handover. */
const BEFORE_HANDOVER = new Set(["draft", "booked"]);

/**
 * What must be fixed before the car changes hands, checked now under the
 * rules the rental was made with. Warnings were allowed when booking; the
 * handover (a later slice) is blocked until these are fixed.
 */
async function BeforeHandoverCard({
  rental,
  clock,
  user,
}: {
  rental: RentalDetail;
  clock: RentalClock;
  user: SignedInUser;
}) {
  if (!BEFORE_HANDOVER.has(rental.status)) {
    return null;
  }
  const problems = await loadRentalProblems(appDb, user.operatorId, rental, clock);
  if (typeof problems === "string") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Before handover</CardTitle>
          <CardDescription>
            {problems === "car_not_found"
              ? "The car has been archived. Restore it, or cancel this rental."
              : "The Renter has been archived. Restore them, or cancel this rental."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (problems.length === 0) {
    return null;
  }
  const isReady = isHandoverAllowed(problems);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{isReady ? "Worth knowing" : "Before handover"}</CardTitle>
        <CardDescription>
          {isReady
            ? "Nothing stops the handover, but check these."
            : "The car cannot be handed over until these are fixed."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="list-disc pl-5 text-sm">
          {problems.map((problem) => (
            <li key={problem.code}>{bookingProblemMessage(problem)}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function RatesCard({ rental }: { rental: RentalDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly rate</CardTitle>
        <CardDescription>
          Each rate applies from its date; earlier weeks keep theirs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RecordList label="Weekly rates">
          {rental.rates.map((rate) => (
            <RecordItem
              key={rate.appliesFrom}
              title={describeRateStart(rate.appliesFrom)}
              amount={formatCents(rate.weeklyRateCents)}
            />
          ))}
        </RecordList>
      </CardContent>
    </Card>
  );
}

function ActionsCard({ rental }: { rental: RentalDetail }) {
  if (!CANCELLABLE.has(rental.status)) {
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{rental.status === "draft" ? "Book or cancel" : "Cancel"}</CardTitle>
        <CardDescription>
          {rental.status === "draft"
            ? "A draft does not hold the car. Book it to hold the car for these dates."
            : "Cancelling lets the car go for these dates. The rental and its Log are kept."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rental.status === "draft" ? (
          <ActionButton
            action={bookDraftAction.bind(null, rental.id)}
            label="Book this car"
            pendingLabel="Booking…"
            variant="default"
            icon={<CalendarCheck aria-hidden />}
          />
        ) : null}
        <FormDialog
          triggerLabel="Cancel this rental"
          title="Cancel this rental"
          triggerIcon={<CircleX aria-hidden />}
        >
          <CancelRentalForm action={cancelRentalAction.bind(null, rental.id)} />
        </FormDialog>
      </CardContent>
    </Card>
  );
}

/** Damage found under this rental: at its return, or later and confirmed as theirs. */
async function RentalDamageCard({ rental, user }: { rental: RentalDetail; user: SignedInUser }) {
  const records = await listRentalDamage(appDb, user.operatorId, rental.id);
  if (records.length === 0) {
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Damage</CardTitle>
        <CardDescription>
          Recorded only. Charging the Renter for damage comes with closing the rental.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DamageList records={records} emptyText="" />
      </CardContent>
    </Card>
  );
}

/** The rental's own changes and its bond entries. */
async function RentalLogTab({ rental, user }: { rental: RentalDetail; user: SignedInUser }) {
  const bond = await loadBondAccount(appDb, user.operatorId, rental);
  return (
    <HistoryCard
      user={user}
      subjects={[
        { entityType: ACTIVITY_ENTITY_TYPES.rental, entityIds: [rental.id] },
        {
          entityType: ACTIVITY_ENTITY_TYPES.bondMovement,
          entityIds: bond.movements.map((movement) => movement.id),
        },
      ]}
      fieldLabel={rentalFieldLabel}
      describeValue={describeRentalValue}
    />
  );
}

/** One rental: who, which car, when, for how much, what is still needed, and its Log. */
export default async function RentalPage(props: {
  params: Promise<{ rentalId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const [{ rentalId }, searchParams] = await Promise.all([props.params, props.searchParams]);
  const clock: RentalClock = { timeZone: user.operatorTimezone, now: new Date() };
  const rental = isRecordId(rentalId)
    ? await loadRental(appDb, user.operatorId, rentalId, clock)
    : null;
  if (!rental) {
    notFound();
  }
  const tab = TAB_LINKS.chosen(searchParams[TAB_PARAM]);

  return (
    <AppShell user={user}>
      <PageHeader
        backHref={RENTALS_PATH}
        backLabel="Rentals"
        title={`${rental.rego} · ${renterDisplayName(rental.renterFullName, rental.renterPreferredName)}`}
        aside={<RentalBadges rental={rental} />}
      />
      <TabLinks
        label="Rental sections"
        tabs={TABS.map((item) => ({
          href: TAB_LINKS.href(rental.id, item.key),
          label: item.label,
          isCurrent: item.key === tab,
          icon: <item.icon aria-hidden />,
        }))}
      />
      {tab === "summary" ? (
        <>
          <BeforeHandoverCard rental={rental} clock={clock} user={user} />
          <ContractCard rental={rental} user={user} clock={clock} />
          <SummaryCard rental={rental} timeZone={user.operatorTimezone} />
          <ChangesCard rental={rental} user={user} clock={clock} />
          <SwapCard rental={rental} user={user} />
          <ReturnCard rental={rental} user={user} />
          <RentalDamageCard rental={rental} user={user} />
          <HandoverCard rental={rental} user={user} />
          <MoneyCard rental={rental} user={user} clock={clock} />
          <BondCard rental={rental} user={user} clock={clock} />
          <RatesCard rental={rental} />
          <ActionsCard rental={rental} />
        </>
      ) : (
        <RentalLogTab rental={rental} user={user} />
      )}
    </AppShell>
  );
}
