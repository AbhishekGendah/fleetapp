import {
  formatShortDayInTimeZone,
  renterDisplayName,
  todayInTimeZone,
  type FuelLevel,
} from "@fleetapp/core";
import { Badge } from "@fleetapp/ui/badge";
import { RecordStrip } from "@fleetapp/ui/record-strip";
import { InlineRecordLink } from "@fleetapp/ui/row-link";
import Link from "next/link";

import type { BondAccount } from "../../../lib/bonds/bond-account";
import type { LedgerView } from "../../../lib/ledger/ledger-queries";
import type { NextRent } from "../../../lib/ledger/next-rent";
import { carPath, RENTALS_PATH, renterPath } from "../../../lib/paths";
import { rentalRateOf } from "../../../lib/rentals/rental-labels";
import {
  atHandoverFact,
  bondFact,
  handoverFact,
  nextRentFact,
  owingFact,
  rentalStatusWords,
  rentFact,
  type RentalFact,
} from "../../../lib/rentals/rental-page-facts";
import type { RentalDetail } from "../../../lib/rentals/rental-queries";
import type { RentalClock } from "../../../lib/rentals/rental-records";
import { RentalAlertBadges } from "../rental-status-badge";
import { ChecklistMainButton, type ReturnProgress } from "./handover-card";

/** What the strip shows that is not on the rental itself. */
export interface RentalStripData {
  ledger: LedgerView | null;
  /** The next rent charge, from the rent run's own rule; none when nothing more is to come. */
  nextRent: NextRent | null;
  bond: BondAccount;
  /** The kilometres and fuel at the handover of the car the Renter has now. */
  handover: { odometerKm: number | null; fuelLevel: FuelLevel | null } | null;
  returnProgress: ReturnProgress | null;
}

/** "Toyota Corolla · weekly, no end date". */
function subtitleOf(rental: RentalDetail, clock: RentalClock): string {
  const rate = rentalRateOf(rental);
  const kind = rate ? (rate.per === "week" ? "weekly" : "daily") : null;
  const today = todayInTimeZone(clock.now, clock.timeZone);
  const ends = rental.plannedEnd
    ? `ends ${formatShortDayInTimeZone(rental.plannedEnd, clock.timeZone, today)}`
    : "no end date";
  return `${rental.make} ${rental.model} · ${kind ? `${kind}, ` : ""}${ends}`;
}

/**
 * The key facts: before the handover, when it is, the rent, the first rent
 * and the bond; once out, what is owing (from the ledger), the next rent
 * (the rent run's own sum), the bond and the kilometres at handover.
 */
function factsOf(rental: RentalDetail, data: RentalStripData, clock: RentalClock): RentalFact[] {
  const bond = bondFact({
    requiredCents: rental.bondCents,
    heldCents: data.bond.heldCents,
    owingCents: data.bond.owingCents,
    onItsWayCents: data.bond.onItsWayCents,
    movements: data.bond.movements,
    isHandedOver: rental.handedOverAt !== null,
  });
  const nextRent = data.nextRent ? nextRentFact(data.nextRent, clock) : null;
  if (!rental.handedOverAt) {
    return [
      ...(rental.status === "draft" || rental.status === "booked"
        ? [handoverFact(rental.plannedStart, clock)]
        : []),
      rentFact(rental),
      nextRent,
      bond,
    ].filter((fact) => fact !== null);
  }
  const today = todayInTimeZone(clock.now, clock.timeZone);
  return [
    data.ledger ? owingFact(data.ledger, today) : null,
    nextRent,
    bond,
    data.handover ? atHandoverFact(data.handover) : null,
  ].filter((fact) => fact !== null);
}

/**
 * The navy strip at the top of one rental's page (the navy strip rule):
 * rego · Renter, each a link; the car and how it runs; its status in plain
 * words; the key facts; and, once out, Start return.
 */
export function RentalStrip(props: {
  rental: RentalDetail;
  data: RentalStripData;
  clock: RentalClock;
}) {
  const { rental, data, clock } = props;
  const status = rentalStatusWords(rental, clock);
  const progress = data.returnProgress;
  return (
    <RecordStrip
      backHref={RENTALS_PATH}
      backLabel="Rentals"
      title={
        <>
          <InlineRecordLink asChild tone="onPrimary" isLinkOnPhones>
            <Link href={carPath(rental.vehicleId)}>{rental.rego}</Link>
          </InlineRecordLink>
          {" · "}
          <InlineRecordLink asChild tone="onPrimary" isLinkOnPhones>
            <Link href={renterPath(rental.renterId)}>
              {renterDisplayName(rental.renterFullName, rental.renterPreferredName)}
            </Link>
          </InlineRecordLink>
        </>
      }
      subtitle={subtitleOf(rental, clock)}
      badges={
        <span className="flex flex-wrap gap-1">
          <Badge tone={status.tone}>{status.text}</Badge>
          <RentalAlertBadges rental={rental} />
        </span>
      }
      facts={factsOf(rental, data, clock)}
      actions={
        progress && !progress.isSwapUnderWay ? (
          <ChecklistMainButton
            kind="return"
            rentalId={rental.id}
            inProgressId={progress.inProgressId}
            variant="inverse"
          />
        ) : undefined
      }
    />
  );
}
