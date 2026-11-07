import { formatCents, renterDisplayName } from "@fleetapp/core";
import { cn } from "@fleetapp/ui/cn";
import type { DataListDefinition } from "@fleetapp/ui/data-list";
import { InlineRecordLink, RowLink } from "@fleetapp/ui/row-link";
import Link from "next/link";

import { carPath, rentalPath, renterPath } from "../../lib/paths";
import { rentalRateOf } from "../../lib/rentals/rental-labels";
import {
  RENTAL_LIST_STATUS_LABELS,
  RENTAL_LIST_STATUSES,
  RENTAL_STATUS_BADGES,
} from "../../lib/rentals/rental-list-status";
import {
  RELEVANCE_ORDER,
  STATUS_FILTER_KEY,
  type RentalSummary,
} from "../../lib/rentals/rental-queries";
import type { RentalClock } from "../../lib/rentals/rental-records";
import { rentalWhenWords, type RentalWhenWords } from "../../lib/rentals/rental-when";
import { RentalBadges } from "./rental-status-badge";

/** A rental as the list shows it: its When in words, and what its Renter owes on it. */
export interface RentalListRow extends RentalSummary {
  when: RentalWhenWords;
  /** From its ledger (rule 11); none when nothing has been charged or paid on it yet. */
  balanceCents: number | null;
}

const NOTHING_YET = "–";
const RATE_UNITS = { day: "day", week: "wk" } as const;

/** "$350.00/wk" or "$70.00/day". */
function rentShortText(rental: RentalSummary): string {
  const rate = rentalRateOf(rental);
  return rate ? `${formatCents(rate.cents)}/${RATE_UNITS[rate.per]}` : NOTHING_YET;
}

function renterName(rental: RentalSummary): string {
  return renterDisplayName(rental.renterFullName, rental.renterPreferredName);
}

type BalanceTone = "owing" | "credit" | "settled";

/** Which way a balance points: owed to the business, owed to the Renter, or neither. */
function balanceToneOf(balanceCents: number): BalanceTone {
  if (balanceCents > 0) return "owing";
  return balanceCents < 0 ? "credit" : "settled";
}

/**
 * Owing is red and bold, credit teal and bold (rule 34: weight as well as
 * colour), so the two can never be mistaken for each other.
 */
const BALANCE_TONE_CLASSES: Record<BalanceTone, string> = {
  owing: "text-destructive font-extrabold",
  credit: "text-teal font-bold",
  settled: "",
};

function creditText(balanceCents: number): string {
  return `${formatCents(-balanceCents)} in credit`;
}

function BalanceText({ balanceCents, text }: { balanceCents: number; text: string }) {
  return (
    <span className={cn("tabular-nums", BALANCE_TONE_CLASSES[balanceToneOf(balanceCents)])}>
      {text}
    </span>
  );
}

/** The computer's Owing column: "$450.00", "$0.00" or "$20.00 in credit", never a minus sign. */
function OwingAmount({ rental }: { rental: RentalListRow }) {
  if (rental.balanceCents === null) {
    return <span className="text-muted-foreground">{NOTHING_YET}</span>;
  }
  const text =
    balanceToneOf(rental.balanceCents) === "credit"
      ? creditText(rental.balanceCents)
      : formatCents(rental.balanceCents);
  return <BalanceText balanceCents={rental.balanceCents} text={text} />;
}

const PHONE_BALANCE_TEXT: Record<BalanceTone, (balanceCents: number) => string> = {
  owing: (balanceCents) => `${formatCents(balanceCents)} owing`,
  credit: creditText,
  settled: () => "Paid up",
};

/** The phone card's money: "$450.00 owing", "Paid up", "$20.00 in credit", or the rent while nothing is charged yet. */
function PhoneMoney({ rental }: { rental: RentalListRow }) {
  if (rental.balanceCents === null) {
    return <span className="tabular-nums">{rentShortText(rental)}</span>;
  }
  const text = PHONE_BALANCE_TEXT[balanceToneOf(rental.balanceCents)](rental.balanceCents);
  return <BalanceText balanceCents={rental.balanceCents} text={text} />;
}

/** The row's own link: the When words, named with the Renter so it makes sense alone (WCAG 2.5.3). */
function WhenLink({ rental, words }: { rental: RentalListRow; words: string }) {
  return (
    <RowLink asChild>
      <Link href={rentalPath(rental.id)} aria-label={`${renterName(rental)}'s rental, ${words}`}>
        {words}
      </Link>
    </RowLink>
  );
}

/**
 * A rental's card on a phone (6 Nov 2026 look): name and status on top,
 * the car, then when and the money. One tap anywhere opens the rental.
 */
export function RentalCard({ rental }: { rental: RentalListRow }) {
  return (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className="text-base font-bold">{renterName(rental)}</span>
        <RentalBadges rental={rental} />
      </span>
      <span className="text-muted-foreground text-sm">
        {rental.rego} · {rental.make} {rental.model}
      </span>
      <span className="flex items-center justify-between gap-2 text-sm">
        <WhenLink rental={rental} words={rental.when.shortText} />
        <PhoneMoney rental={rental} />
      </span>
    </>
  );
}

/** The Rentals list (docs/plans/look-and-feel.md, "Rentals list"). */
export const RENTAL_LIST: DataListDefinition<RentalListRow> = {
  columns: [
    {
      key: "renter",
      label: "Renter",
      isCardTitle: true,
      isSortable: true,
      exportValue: renterName,
      render: (rental) => (
        <InlineRecordLink asChild>
          <Link href={renterPath(rental.renterId)}>{renterName(rental)}</Link>
        </InlineRecordLink>
      ),
    },
    {
      key: "rego",
      label: "Car",
      isSortable: true,
      exportValue: (rental) => `${rental.rego} ${rental.make} ${rental.model}`,
      render: (rental) => (
        <span>
          <InlineRecordLink asChild>
            <Link href={carPath(rental.vehicleId)}>{rental.rego}</Link>
          </InlineRecordLink>{" "}
          <span className="text-muted-foreground">
            {rental.make} {rental.model}
          </span>
        </span>
      ),
    },
    {
      key: "start",
      label: "When",
      isSortable: true,
      exportValue: (rental) => rental.when.text,
      render: (rental) => <WhenLink rental={rental} words={rental.when.text} />,
    },
    { key: "rent", label: "Rent", exportValue: rentShortText },
    {
      key: "owing",
      label: "Owing",
      isAlignedEnd: true,
      exportValue: (rental) => rental.balanceCents,
      render: (rental) => <OwingAmount rental={rental} />,
    },
    {
      key: "status",
      label: "Status",
      isSortable: true,
      exportValue: (rental) => RENTAL_STATUS_BADGES[rental.status].text,
      render: (rental) => <RentalBadges rental={rental} />,
    },
  ],
  filters: [
    {
      key: STATUS_FILTER_KEY,
      label: "Status",
      options: RENTAL_LIST_STATUSES.map((status) => ({
        value: status,
        label: RENTAL_LIST_STATUS_LABELS[status],
      })),
    },
  ],
  defaultSort: { column: RELEVANCE_ORDER, direction: "asc" },
};

/** The page's rentals with their When and balance, on the Operator's clock (rule 10). */
export function rentalListRows(
  rentals: readonly RentalSummary[],
  balances: ReadonlyMap<string, number>,
  clock: RentalClock,
): RentalListRow[] {
  return rentals.map((rental) => ({
    ...rental,
    when: rentalWhenWords(rental, clock),
    balanceCents: balances.get(rental.id) ?? null,
  }));
}
