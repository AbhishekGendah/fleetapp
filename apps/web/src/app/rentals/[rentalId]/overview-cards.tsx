import {
  formatAbn,
  formatCalendarDate,
  formatCents,
  formatDateTimeInTimeZone,
  RENTAL_TYPE_LABELS,
  renterShownName,
} from "@fleetapp/core";
import { Card, CardContent, CardDescription, CardHeader, SectionLabel } from "@fleetapp/ui/card";
import { FormDialog } from "@fleetapp/ui/form-dialog";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";
import { InlineRecordLink } from "@fleetapp/ui/row-link";
import { CircleX } from "lucide-react";
import Link from "next/link";

import { DetailLines, type DetailLine } from "../../../components/detail-lines";
import { SectionCard, SectionLink } from "../../../components/section-card";
import { appDb } from "../../../lib/app-db";
import { listRentalDamage } from "../../../lib/damage/damage-queries";
import type { LedgerView } from "../../../lib/ledger/ledger-queries";
import { carPath, renterPath } from "../../../lib/paths";
import { rentalRateText, rentTimingText } from "../../../lib/rentals/rental-labels";
import { rentalRenterNames, type RentalDetail } from "../../../lib/rentals/rental-queries";
import type { SignedInUser } from "../../../lib/require-user";
import { DamageList } from "../../cars/damage-list";
import { lineTitle, signedAmount } from "../ledger-line-list";
import { cancelRentalAction } from "./actions";
import { CancelRentalForm } from "./cancel-form";
import { RENTAL_TAB_LINKS } from "./rental-tabs";

/** A draft or a booking can still be cancelled; after handover it is returned instead. */
const CANCELLABLE = new Set(["draft", "booked"]);

/** A business's rental: its legal name and ABN under its name (mockup 6). */
function BusinessRenterValue({ rental }: { rental: RentalDetail }) {
  return (
    <span className="flex flex-col">
      <InlineRecordLink asChild isLinkOnPhones>
        <Link href={renterPath(rental.renterId)}>{renterShownName(rentalRenterNames(rental))}</Link>
      </InlineRecordLink>
      <span className="text-muted-foreground text-sm">
        {[rental.renterFullName, rental.renterAbn ? `ABN ${formatAbn(rental.renterAbn)}` : null]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </span>
  );
}

/** Who drives a business's car: the driver as a link, or "To be named" (decision 2). */
function DriverValue({ rental }: { rental: RentalDetail }) {
  if (!rental.driverId || !rental.driverFullName) {
    return <span>To be named</span>;
  }
  return (
    <InlineRecordLink asChild isLinkOnPhones>
      <Link href={renterPath(rental.driverId)}>{rental.driverFullName}</Link>
    </InlineRecordLink>
  );
}

/** Who rents, and for a business who drives: each a link. */
function partyLines(rental: RentalDetail): DetailLine[] {
  if (rental.renterKind !== "organisation") {
    return [
      [
        "Renter",
        <InlineRecordLink key="renter" asChild isLinkOnPhones>
          <Link href={renterPath(rental.renterId)}>
            {renterShownName(rentalRenterNames(rental))}
          </Link>
        </InlineRecordLink>,
      ],
    ];
  }
  return [
    ["Renter", <BusinessRenterValue key="renter" rental={rental} />],
    ["Driver", <DriverValue key="driver" rental={rental} />],
  ];
}

/** The rental's details, label beside value, with the Renter (and driver) and the car as links. */
export function RentalDetailsCard({
  rental,
  timeZone,
  driverAction,
}: {
  rental: RentalDetail;
  timeZone: string;
  /** A business's booking: change its named driver. */
  driverAction?: React.ReactNode;
}) {
  const onClock = (moment: Date) => formatDateTimeInTimeZone(moment, timeZone);
  const lines: DetailLine[] = [
    ...partyLines(rental),
    [
      "Car",
      <InlineRecordLink key="car" asChild isLinkOnPhones>
        <Link href={carPath(rental.vehicleId)}>
          {rental.rego} · {rental.make} {rental.model}
        </Link>
      </InlineRecordLink>,
    ],
    ["Kind", RENTAL_TYPE_LABELS[rental.type]],
    rental.handedOverAt
      ? ["Started", onClock(rental.handedOverAt)]
      : ["Starts", onClock(rental.plannedStart)],
    ["Ends", rental.plannedEnd ? onClock(rental.plannedEnd) : "No end date yet (ongoing)"],
    ["Rate", rentalRateText(rental)],
    ["Bond", formatCents(rental.bondCents)],
    ["Rent", rentTimingText(rental)],
    ["Notes", rental.notes ?? "None"],
  ];
  if (rental.cancellationReason) {
    lines.push(["Why it was cancelled", rental.cancellationReason]);
  }
  return (
    <Card>
      <CardHeader>
        <SectionLabel>Rental</SectionLabel>
        <CardDescription>
          Made with your settings as they were then (version {rental.settingsVersion}). Later
          changes to Settings do not apply to it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <DetailLines lines={lines} />
        {driverAction}
      </CardContent>
    </Card>
  );
}

export function RatesCard({ rental }: { rental: RentalDetail }) {
  return (
    <Card>
      <CardHeader>
        <SectionLabel>Rates</SectionLabel>
        <CardDescription>
          Each rate applies from its start; earlier weeks keep theirs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RecordList label="Rates">
          {rental.rates.map((rate) => (
            <RecordItem key={rate.key} title={rate.startsText} amount={rate.rateText} />
          ))}
        </RecordList>
      </CardContent>
    </Card>
  );
}

/** Cancelling a draft or a booking (booking a draft is its Next step). */
export function CancelCard({ rental }: { rental: RentalDetail }) {
  if (!CANCELLABLE.has(rental.status)) {
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <SectionLabel>Cancel</SectionLabel>
        <CardDescription>
          {rental.status === "draft"
            ? "A draft does not hold the car. Cancel it if it is not going ahead."
            : "Cancelling lets the car go for these dates. The rental and its Log are kept."}
        </CardDescription>
      </CardHeader>
      <CardContent>
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
export async function RentalDamageCard({
  rental,
  user,
}: {
  rental: RentalDetail;
  user: SignedInUser;
}) {
  const records = await listRentalDamage(appDb, user.operatorId, rental.id);
  if (records.length === 0) {
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <SectionLabel>Damage</SectionLabel>
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

/** How many lines the Overview shows; the Money tab has the rest. */
const LATEST_LINES_SHOWN = 3;

/**
 * The newest money lines, newest first: on a rental's Overview (on a
 * computer) and a Renter's, where `showRego` names each line's car.
 */
export function LatestMoneyLines({
  ledger,
  showRego = false,
}: {
  ledger: LedgerView;
  showRego?: boolean;
}) {
  const newest = [...ledger.lines].reverse().slice(0, LATEST_LINES_SHOWN);
  if (newest.length === 0) {
    return (
      <p className="text-muted-foreground border-t py-3 text-sm">Nothing charged or paid yet.</p>
    );
  }
  return (
    <ul aria-label="Newest money lines">
      {newest.map((line) => (
        <li key={line.id} className="flex items-center gap-3 border-t py-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">{lineTitle(line)}</p>
            <p className="text-muted-foreground truncate text-xs">
              {formatCalendarDate(line.effectiveOn)}
              {showRego ? ` · ${line.rego}` : ""} · {line.description}
            </p>
          </div>
          <p className="font-bold whitespace-nowrap">{signedAmount(line, ledger)}</p>
        </li>
      ))}
    </ul>
  );
}

/** On a computer's Overview: the newest money lines, and All money. */
export function LatestMoneyCard({ rentalId, ledger }: { rentalId: string; ledger: LedgerView }) {
  return (
    <SectionCard
      heading="Latest money"
      aside={<SectionLink href={RENTAL_TAB_LINKS.href(rentalId, "money")}>All money</SectionLink>}
    >
      <LatestMoneyLines ledger={ledger} />
    </SectionCard>
  );
}
