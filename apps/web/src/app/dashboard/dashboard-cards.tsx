import {
  CLAIM_STATUS_LABELS,
  expiryStatus,
  formatCalendarDate,
  formatCents,
  formatDateTimeInTimeZone,
  VEHICLE_STATUS_LABELS,
  type RentalMoment,
  type VehicleStatus,
} from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@fleetapp/ui/card";
import { CountLinks } from "@fleetapp/ui/count-links";
import { CarFront, FilePlus2, UserPlus } from "lucide-react";
import Link from "next/link";

import { handoverBlockerLabel, RENTAL_MOMENT_HEADINGS } from "../../lib/dashboard/dashboard-labels";
import type { CarOnList } from "../../lib/dashboard/fleet-overview";
import type { DamageOnDashboard } from "../../lib/damage/damage-queries";
import type { DashboardData } from "../../lib/dashboard/load-dashboard";
import type { RentalThisWeek } from "../../lib/dashboard/rentals-this-week";
import {
  carDamagePath,
  carPath,
  carsWithStatusPath,
  NEW_CAR_PATH,
  NEW_RENTAL_PATH,
  NEW_RENTER_PATH,
  rentalPath,
  rentalsWithStatusPath,
  renterPath,
  renterReviewPath,
} from "../../lib/paths";
import { idleText } from "../../lib/vehicles/car-list-rows";
import { AttentionGroup, type AttentionItem } from "./attention-group";

/** The statuses of cars in the fleet, in the order the counts show them. */
const FLEET_STATUSES: readonly VehicleStatus[] = ["rented", "available", "in_service", "off_road"];
const SHOWN_PER_GROUP = 5;

function carTitle(car: CarOnList): string {
  return `${car.rego} · ${car.make} ${car.model}`;
}

function rentalItem(rental: RentalThisWeek, timeZone: string, data: DashboardData): AttentionItem {
  const isReturn = rental.status === "active";
  const when = isReturn ? rental.plannedEnd : rental.plannedStart;
  const verb = isReturn ? "Due back" : "Starts";
  const blockers = data.notReady.find((booking) => booking.rentalId === rental.id)?.blockers ?? [];
  return {
    key: rental.id,
    href: rentalPath(rental.id),
    title: `${rental.rego} · ${rental.renterFullName}`,
    details: when ? `${verb} ${formatDateTimeInTimeZone(when, timeZone)}` : null,
    badges: blockers.map((blocker) => ({
      label: handoverBlockerLabel(blocker),
      tone: "attention",
    })),
  };
}

function RentalGroup(props: { moment: RentalMoment; data: DashboardData; timeZone: string }) {
  const rentals = props.data.rentals.filter((rental) => rental.moment === props.moment);
  const status = rentals[0]?.status ?? "booked";
  return (
    <AttentionGroup
      heading={RENTAL_MOMENT_HEADINGS[props.moment]}
      total={rentals.length}
      items={rentals
        .slice(0, SHOWN_PER_GROUP)
        .map((rental) => rentalItem(rental, props.timeZone, props.data))}
      seeAll={{ href: rentalsWithStatusPath(status), label: "See all in Rentals" }}
    />
  );
}

function NotReadyGroup({ data, timeZone }: { data: DashboardData; timeZone: string }) {
  const bookings = data.rentals.filter((rental) =>
    data.notReady.some((booking) => booking.rentalId === rental.id),
  );
  return (
    <AttentionGroup
      heading="Not ready for handover"
      total={bookings.length}
      items={bookings.map((rental) => rentalItem(rental, timeZone, data))}
    />
  );
}

function paperworkDetails(
  car: DashboardData["paperworkDue"]["items"][number],
  data: DashboardData,
) {
  // Cover that ran out reads as Expired; Missing is for none on file, or one not started yet.
  const isRegoMissing = !car.isRegisteredToday && !isPast(car.regoExpiresOn, data.window.today);
  const isInsuranceMissing = !car.isInsuredToday && !isPast(car.insuranceEndsOn, data.window.today);
  const lines = [
    isRegoMissing ? "No current rego" : null,
    isInsuranceMissing ? "No current insurance" : null,
    car.regoExpiresOn ? `Rego ${formatCalendarDate(car.regoExpiresOn)}` : null,
    car.insuranceEndsOn ? `Insurance ${formatCalendarDate(car.insuranceEndsOn)}` : null,
  ].filter(Boolean);
  const isMissing = isRegoMissing || isInsuranceMissing;
  const firstDue = [car.regoExpiresOn, car.insuranceEndsOn].filter(Boolean).sort()[0] ?? null;
  const status = expiryStatus(firstDue, data.window.today, data.vehicleWarningDays);
  return { text: lines.join(" · "), isMissing, isExpired: status === "expired" };
}

function isPast(day: string | null, today: string): boolean {
  return day !== null && day < today;
}

function paperworkBadge(details: { isMissing: boolean; isExpired: boolean }) {
  if (details.isMissing) {
    return { label: "Missing", tone: "danger" as const };
  }
  return details.isExpired
    ? { label: "Expired", tone: "danger" as const }
    : { label: "Due soon", tone: "attention" as const };
}

function PaperworkGroups({ data }: { data: DashboardData }) {
  return (
    <>
      <AttentionGroup
        heading="Rego or insurance due or missing"
        total={data.paperworkDue.total}
        items={data.paperworkDue.items.map((car) => {
          const details = paperworkDetails(car, data);
          return {
            key: car.id,
            href: carPath(car.id),
            title: carTitle(car),
            details: details.text,
            badges: [paperworkBadge(details)],
          };
        })}
      />
      <AttentionGroup
        heading="Licences due, of Renters renting"
        total={data.licencesDue.total}
        items={data.licencesDue.items.map((renter) => ({
          key: renter.id,
          href: renterPath(renter.id),
          title: renter.fullName,
          details: `Licence expires ${formatCalendarDate(renter.licenceExpiresOn)}`,
        }))}
      />
      <AttentionGroup
        heading="Late back from the workshop"
        total={data.workshopLate.total}
        items={data.workshopLate.items.map((car) => ({
          key: car.id,
          href: carPath(car.id),
          title: carTitle(car),
          details: `${VEHICLE_STATUS_LABELS[car.status]}, expected back ${car.statusExpectedBack ? formatCalendarDate(car.statusExpectedBack) : ""}`,
        }))}
      />
    </>
  );
}

function damageItem(damage: DamageOnDashboard): AttentionItem {
  return {
    key: damage.id,
    href: carDamagePath(damage.vehicleId, damage.id),
    title: `${damage.rego}: ${damage.description}`,
    details: `Found ${formatCalendarDate(damage.foundOn)}`,
    badges: damage.claimStatus
      ? [
          {
            label: `Claim ${CLAIM_STATUS_LABELS[damage.claimStatus].toLowerCase()}`,
            tone: "neutral",
          },
        ]
      : [],
  };
}

/** Damage still to repair or decide on, and insurance claims waiting on the insurer. */
function DamageGroups({ data }: { data: DashboardData }) {
  return (
    <>
      <AttentionGroup
        heading="Damage open"
        total={data.damage.openDamage.total}
        items={data.damage.openDamage.items.map(damageItem)}
      />
      <AttentionGroup
        heading="Claims under way"
        total={data.damage.claimsUnderWay.total}
        items={data.damage.claimsUnderWay.items.map(damageItem)}
      />
    </>
  );
}

function hasAttention(data: DashboardData): boolean {
  const urgentRentals = data.rentals.some(
    (rental) => rental.moment === "overdue" || rental.moment === "late_pickup",
  );
  return (
    urgentRentals ||
    data.notReady.length > 0 ||
    data.reviewsWaiting.total > 0 ||
    data.bondsToRefund.total > 0 ||
    data.paperworkDue.total > 0 ||
    data.licencesDue.total > 0 ||
    data.workshopLate.total > 0 ||
    data.damage.openDamage.total > 0 ||
    data.damage.claimsUnderWay.total > 0
  );
}

/** Most urgent first (docs/design/09): what is late, what blocks a handover, what is running out. */
export function NeedsAttentionCard({ data, timeZone }: { data: DashboardData; timeZone: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Needs attention</CardTitle>
        {hasAttention(data) ? null : (
          <CardDescription>Nothing needs your attention.</CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <RentalGroup moment="overdue" data={data} timeZone={timeZone} />
        <RentalGroup moment="late_pickup" data={data} timeZone={timeZone} />
        <NotReadyGroup data={data} timeZone={timeZone} />
        <AttentionGroup
          heading="Renter details to review"
          total={data.reviewsWaiting.total}
          items={data.reviewsWaiting.items.map((renter) => ({
            key: renter.id,
            href: renterReviewPath(renter.id),
            title: renter.fullName,
          }))}
        />
        <AttentionGroup
          heading="Bond to refund on a cancelled booking"
          total={data.bondsToRefund.total}
          items={data.bondsToRefund.items.map((rental) => ({
            key: rental.rentalId,
            href: rentalPath(rental.rentalId),
            title: `${rental.rego} · ${rental.renterName}: ${formatCents(rental.heldCents)}`,
          }))}
        />
        <PaperworkGroups data={data} />
        <DamageGroups data={data} />
      </CardContent>
    </Card>
  );
}

const WEEK_MOMENTS: readonly RentalMoment[] = [
  "pickup_today",
  "returning_today",
  "starting_this_week",
  "ending_this_week",
];

/** Pickups and returns today, then the rest of the week. Times on the Operator's clock (rule 10). */
export function ThisWeekCard({ data, timeZone }: { data: DashboardData; timeZone: string }) {
  const hasAny = data.rentals.some((rental) => WEEK_MOMENTS.includes(rental.moment));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Today and this week</CardTitle>
        {hasAny ? null : (
          <CardDescription>No pickups or returns in the next seven days.</CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {WEEK_MOMENTS.map((moment) => (
          <RentalGroup key={moment} moment={moment} data={data} timeZone={timeZone} />
        ))}
      </CardContent>
    </Card>
  );
}

/** Where every car is, as counts that open the list, and the cars earning nothing. */
export function FleetCard({ data, timeZone }: { data: DashboardData; timeZone: string }) {
  const links = FLEET_STATUSES.filter((status) => (data.fleetCounts[status] ?? 0) > 0).map(
    (status) => ({
      href: carsWithStatusPath(status),
      label: VEHICLE_STATUS_LABELS[status],
      count: data.fleetCounts[status] ?? 0,
    }),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Fleet</CardTitle>
        {links.length === 0 ? <CardDescription>No cars yet.</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {links.length > 0 ? <CountLinks label="Cars by status" links={links} /> : null}
        <AttentionGroup
          heading="Idle: available, nothing booked"
          total={data.idleCars.total}
          items={data.idleCars.items.map((car) => ({
            key: car.id,
            href: carPath(car.id),
            title: carTitle(car),
            details: idleText(car.idleSince, { now: data.window.now, timeZone }),
          }))}
          seeAll={{ href: carsWithStatusPath("available"), label: "See all available cars" }}
        />
      </CardContent>
    </Card>
  );
}

export function QuickActions() {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <Button asChild>
        <Link href={NEW_RENTAL_PATH}>
          <FilePlus2 aria-hidden />
          New rental
        </Link>
      </Button>
      <Button asChild variant="outline">
        <Link href={NEW_CAR_PATH}>
          <CarFront aria-hidden />
          Add a car
        </Link>
      </Button>
      <Button asChild variant="outline">
        <Link href={NEW_RENTER_PATH}>
          <UserPlus aria-hidden />
          Add a Renter
        </Link>
      </Button>
    </div>
  );
}
