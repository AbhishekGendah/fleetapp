import { RENTER_KIND_LABELS } from "@fleetapp/core";
import { Badge } from "@fleetapp/ui/badge";
import type { DataListDefinition } from "@fleetapp/ui/data-list";
import { InlineRecordLink, RowLink } from "@fleetapp/ui/row-link";
import Link from "next/link";

import { balanceAmountText, BalanceText, balanceWordsText } from "../../components/balance-amount";
import { carPath, renterPath } from "../../lib/paths";
import type { RenterListRow } from "../../lib/renters/renter-list-rows";
import {
  RENTER_LIST_FILTER_LABELS,
  RENTER_LIST_FILTERS,
  type RenterBadge,
} from "../../lib/renters/renter-list-status";
import { STATUS_FILTER_KEY } from "../../lib/renters/renter-queries";
import { ExpiryDate } from "../cars/expiry-date";

const NOTHING_YET = "–";
const NOT_ON_FILE = "Not on file";

function nameOf(renter: RenterListRow): string {
  return renter.shownName;
}

/** "Business", "Driver for Acme Rides": grey outlined, lighter than any status (7 Nov 2026 mockups). */
export function RenterKindLabels({ labels }: { labels: readonly string[] }) {
  if (labels.length === 0) {
    return null;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {labels.map((label) => (
        <Badge key={label} tone="kind">
          {label}
        </Badge>
      ))}
    </span>
  );
}

/** Under the name: a business's legal name (when it trades by another), then the phone. */
function NameNote({ renter }: { renter: RenterListRow }) {
  const parts = [
    renter.kind === "organisation" && renter.shownName !== renter.fullName ? renter.fullName : null,
    renter.phone,
  ].filter(Boolean);
  return parts.length > 0 ? (
    <span className="text-muted-foreground text-xs tabular-nums">{parts.join(" · ")}</span>
  ) : null;
}

export function RenterBadges({ badges }: { badges: readonly RenterBadge[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {badges.map((badge) => (
        <Badge key={badge.text} tone={badge.tone}>
          {badge.text}
        </Badge>
      ))}
    </span>
  );
}

/** The name, bold teal: the row's own link, opening the Renter from anywhere on the row. */
function NameLink({ renter }: { renter: RenterListRow }) {
  return (
    <RowLink asChild className="text-teal hover:text-primary font-extrabold">
      <Link href={renterPath(renter.id)}>{nameOf(renter)}</Link>
    </RowLink>
  );
}

/** "3DEF456" (opening the car) over "Back today 3:30 pm"; or "Last back Tue 29 Sep". */
function RentingWords({ renter }: { renter: RenterListRow }) {
  const { renting } = renter;
  if (!renting.rental) {
    return <span className="text-muted-foreground">{renting.words}</span>;
  }
  return (
    <span className="flex flex-col items-start">
      <InlineRecordLink asChild>
        <Link href={carPath(renting.rental.vehicleId)}>{renting.rental.rego}</Link>
      </InlineRecordLink>
      <span className="text-muted-foreground text-xs">{renting.words}</span>
    </span>
  );
}

/**
 * "$450.00" red, "$20.00 in credit" teal, "$0.00" grey, or "–" while nothing
 * is charged yet; for a driver in a business's car, "Acme Rides pays".
 */
function OwingAmount({ renter }: { renter: RenterListRow }) {
  if (renter.paidByText) {
    return <span className="text-muted-foreground">{renter.paidByText}</span>;
  }
  if (renter.balanceCents === null) {
    return <span className="text-muted-foreground">{NOTHING_YET}</span>;
  }
  return (
    <BalanceText balanceCents={renter.balanceCents} text={balanceAmountText(renter.balanceCents)} />
  );
}

/**
 * A Renter's card on a phone (7 Nov 2026 look): name and status on top,
 * their car and when it is back (or when they last had one), then since when
 * they have rented and the money. The phone number only, never the email.
 * One tap anywhere opens the Renter.
 */
export function RenterCard({ renter }: { renter: RenterListRow }) {
  const { renting } = renter;
  return (
    <>
      <span className="flex items-start justify-between gap-2">
        <NameLink renter={renter} />
        <RenterBadges badges={renter.badges} />
      </span>
      <RenterKindLabels labels={renter.kindLabels} />
      <span className="text-muted-foreground text-sm">
        {renting.rental ? `${renting.rental.rego} · ${renting.shortWords}` : renting.words}
      </span>
      <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
        <span>Since {renter.sinceText}</span>
        {renter.paidByText ? (
          <span className="text-muted-foreground">{renter.paidByText}</span>
        ) : renter.balanceCents === null ? null : (
          <BalanceText
            balanceCents={renter.balanceCents}
            text={balanceWordsText(renter.balanceCents)}
          />
        )}
      </span>
    </>
  );
}

/**
 * The Renters list (docs/plans/look-and-feel.md, "Cars and Renters pages"),
 * for the screen and both exports. It shows the phone only, never the email,
 * and the licence's expiry only, never its number (Abhi, 7 Nov 2026); the
 * exports hold only what is shown here (never a date of birth or address),
 * with a business's kind and legal name (business-renters slice 2).
 */
export const RENTER_LIST: DataListDefinition<RenterListRow> = {
  columns: [
    {
      key: "name",
      label: "Renter",
      isCardTitle: true,
      isSortable: true,
      exportValue: nameOf,
      render: (renter) => (
        <span className="flex flex-col items-start gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <NameLink renter={renter} />
            <RenterKindLabels labels={renter.kindLabels} />
          </span>
          <NameNote renter={renter} />
        </span>
      ),
    },
    {
      key: "kind",
      label: "Kind",
      isOnlyInExports: true,
      exportValue: (renter) =>
        [
          RENTER_KIND_LABELS[renter.kind],
          ...renter.kindLabels.filter((label) => label !== RENTER_KIND_LABELS.organisation),
        ].join(", "),
    },
    {
      key: "legalName",
      label: "Legal name",
      isOnlyInExports: true,
      exportValue: (renter) => (renter.kind === "organisation" ? renter.fullName : null),
    },
    {
      key: "phone",
      label: "Phone",
      isOnlyInExports: true,
      exportValue: (renter) => renter.phone,
    },
    {
      key: "status",
      label: "Status",
      exportValue: (renter) => renter.badges.map((badge) => badge.text).join(", "),
      render: (renter) => <RenterBadges badges={renter.badges} />,
    },
    {
      key: "renting",
      label: "Renting",
      exportValue: (renter) =>
        renter.renting.rental
          ? `${renter.renting.rental.rego} ${renter.renting.words}`
          : renter.renting.words,
      render: (renter) => <RentingWords renter={renter} />,
    },
    {
      key: "owing",
      label: "Owing",
      isAlignedEnd: true,
      exportValue: (renter) => renter.paidByText ?? renter.balanceCents,
      render: (renter) => <OwingAmount renter={renter} />,
    },
    {
      key: "licenceExpires",
      label: "Licence to",
      isSortable: true,
      exportValue: (renter) => renter.licenceExpiresOn,
      render: (renter) =>
        renter.licenceExpiresOn ? (
          <ExpiryDate date={renter.licenceExpiresOn} status={renter.licenceStatus} />
        ) : (
          <span className="text-muted-foreground">{NOT_ON_FILE}</span>
        ),
    },
    {
      key: "since",
      label: "Since",
      isSortable: true,
      exportValue: (renter) => renter.sinceText,
    },
  ],
  filters: [
    {
      key: STATUS_FILTER_KEY,
      label: "Status",
      options: RENTER_LIST_FILTERS.map((filter) => ({
        value: filter,
        label: RENTER_LIST_FILTER_LABELS[filter],
      })),
    },
  ],
  defaultSort: { column: "name", direction: "asc" },
};
