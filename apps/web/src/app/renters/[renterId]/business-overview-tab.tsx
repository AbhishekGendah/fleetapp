import {
  BUSINESS_DETAIL_NEEDED_LABELS,
  businessDetailsStillNeeded,
  renterDisplayName,
} from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { Card, CardContent, CardDescription, CardHeader, SectionLabel } from "@fleetapp/ui/card";
import { cn } from "@fleetapp/ui/cn";
import { InlineRecordLink, ROW_CLASSES, RowLink } from "@fleetapp/ui/row-link";
import { Pencil, Plus } from "lucide-react";
import Link from "next/link";

import { balanceAmountText, BalanceText } from "../../../components/balance-amount";
import { SectionCard, SectionLink } from "../../../components/section-card";
import { appDb } from "../../../lib/app-db";
import { carPath, editRenterPath, rentalPath, renterPath } from "../../../lib/paths";
import type { RentalClock } from "../../../lib/rentals/rental-records";
import type { SignedInUser } from "../../../lib/require-user";
import { driverBadge } from "../../../lib/renters/driver-standing";
import { findRentersSharingContact, type RenterDetail } from "../../../lib/renters/renter-queries";
import { CARD_ROW_CLASSES, RentalRow } from "../../rentals/rental-row";
import { RenterBadges } from "../renter-list";
import type { BusinessPageData } from "./business-page-data";
import { QUIET_LINE_CLASSES } from "./card-lines";
import { ContactCard, LatestNoteCard, OwingLine } from "./overview-tab";
import { SharedContactNote } from "./renter-alerts";
import type { RenterPageData } from "./renter-page-data";
import { BUSINESS_TAB_LINKS } from "./renter-tabs";

/** How many drivers the Overview lists before "All drivers". */
const DRIVERS_SHOWN = 5;

/** What the business still needs on file before it can rent (slice 3 refuses until then). */
function BusinessStillNeededCard({ renter }: { renter: RenterDetail }) {
  const missing = businessDetailsStillNeeded(renter);
  if (missing.length === 0) {
    return null;
  }
  return (
    <Card className="border-attention/40">
      <CardHeader>
        <SectionLabel>Still needed before renting</SectionLabel>
        <CardDescription>Its cars will not go out until these are on file.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="list-disc pl-5 text-sm">
          {missing.map((detail) => (
            <li key={detail}>{BUSINESS_DETAIL_NEEDED_LABELS[detail]}</li>
          ))}
        </ul>
        {renter.archivedAt ? null : (
          <Button asChild className="w-full sm:w-auto sm:self-start">
            <Link href={editRenterPath(renter.id)}>
              <Pencil aria-hidden />
              Add the details
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * What the business owes across its cars (each rental's own ledger, added
 * up: rule 11), how late if any car is overdue, and each car out or booked
 * with its driver and what is owing on it.
 */
function MoneyAcrossCarsCard(props: {
  renter: RenterDetail;
  data: RenterPageData;
  business: BusinessPageData;
}) {
  const cars = props.business.moneyByCar.filter(
    (car) => car.status === "active" || car.status === "booked",
  );
  return (
    <SectionCard
      heading="Money across cars"
      aside={
        <SectionLink href={BUSINESS_TAB_LINKS.href(props.renter.id, "money")}>
          All money
        </SectionLink>
      }
    >
      <OwingLine data={props.data} />
      <ul aria-label="Money on each car">
        {cars.map((car) => (
          <li key={car.id} className={cn(ROW_CLASSES, CARD_ROW_CLASSES)}>
            <RowLink asChild className="flex min-w-0 flex-1 flex-col">
              <Link
                href={rentalPath(car.id)}
                aria-label={`Rental of ${car.rego}${car.driverName ? `, driven by ${car.driverName}` : ""}`}
              >
                <span className="font-bold">{car.rego}</span>
                <span className="text-muted-foreground text-sm">
                  {car.driverName ?? "Driver to be named"}
                </span>
              </Link>
            </RowLink>
            <BalanceText
              balanceCents={car.balanceCents}
              text={balanceAmountText(car.balanceCents)}
            />
          </li>
        ))}
        {cars.length === 0 ? <li className={QUIET_LINE_CLASSES}>No cars out or booked.</li> : null}
      </ul>
      <p className={QUIET_LINE_CLASSES}>
        Each car is debited and invoiced on its own; add a charge or payment on its rental&rsquo;s
        page.
      </p>
    </SectionCard>
  );
}

/** Its cars out and booked, each with its driver (or "driver to be named"). */
function CarsOutCard(props: {
  renter: RenterDetail;
  data: RenterPageData;
  business: BusinessPageData;
  clock: RentalClock;
}) {
  const { rentalsUnderWay } = props.data;
  return (
    <SectionCard
      heading="Cars out now"
      aside={
        <SectionLink href={BUSINESS_TAB_LINKS.href(props.renter.id, "rentals")}>
          All rentals
        </SectionLink>
      }
    >
      <ul aria-label="Cars out and booked">
        {rentalsUnderWay.map((rental) => {
          const driverName = rental.driverId
            ? props.business.driverNames.get(rental.driverId)
            : undefined;
          return (
            <RentalRow
              key={rental.id}
              lead={
                <>
                  <InlineRecordLink asChild>
                    <Link href={carPath(rental.vehicleId)}>{rental.rego}</Link>
                  </InlineRecordLink>{" "}
                  · {rental.make} {rental.model} ·{" "}
                  <span className="font-normal">
                    {driverName ? `driver ${driverName}` : "driver to be named"}
                  </span>
                </>
              }
              rentalName={`Rental of ${rental.rego}`}
              rental={rental}
              clock={props.clock}
            />
          );
        })}
        {rentalsUnderWay.length === 0 ? (
          <li className={QUIET_LINE_CLASSES}>No cars out or booked.</li>
        ) : null}
      </ul>
    </SectionCard>
  );
}

/** Its current drivers: what each is driving now, and their standing. */
function DriversCard(props: {
  renter: RenterDetail;
  data: RenterPageData;
  business: BusinessPageData;
}) {
  const { currentDrivers, carsOut } = props.business;
  const isEditable = props.renter.archivedAt === null;
  const driversHref = BUSINESS_TAB_LINKS.href(props.renter.id, "drivers");
  return (
    <SectionCard
      heading={`Drivers · ${currentDrivers.length}`}
      aside={<SectionLink href={driversHref}>All drivers</SectionLink>}
    >
      <ul aria-label="Drivers">
        {currentDrivers.slice(0, DRIVERS_SHOWN).map((driver) => {
          const car = carsOut.find((out) => out.driverId === driver.driverId);
          const name = renterDisplayName(driver.fullName, driver.preferredName);
          return (
            <li key={driver.linkId} className={cn(ROW_CLASSES, CARD_ROW_CLASSES)}>
              <RowLink asChild className="flex min-w-0 flex-1 flex-col">
                <Link href={renterPath(driver.driverId)}>
                  <span className="text-teal font-extrabold">{name}</span>
                  <span className="text-muted-foreground text-sm">
                    {car ? `Driving ${car.rego}` : "Not driving now"}
                  </span>
                </Link>
              </RowLink>
              <RenterBadges badges={[driverBadge(driver, props.data.licenceExpiry)]} />
            </li>
          );
        })}
        {currentDrivers.length === 0 ? (
          <li className={QUIET_LINE_CLASSES}>
            No drivers yet. Only its drivers can be named on its cars.
          </li>
        ) : null}
      </ul>
      {isEditable ? (
        <div className="border-t py-2">
          <SectionLink href={driversHref}>
            <Plus aria-hidden className="size-4" />
            Add a driver
          </SectionLink>
        </div>
      ) : null}
    </SectionCard>
  );
}

/**
 * A business Renter's Overview (7 Nov 2026 mockups): anything still needed
 * first, then its money across cars, its cars out and its latest note; on a
 * computer, its drivers and contact beside them.
 */
export async function BusinessOverviewTab(props: {
  renter: RenterDetail;
  data: RenterPageData;
  business: BusinessPageData;
  user: SignedInUser;
  clock: RentalClock;
}) {
  const { renter, data, business, user } = props;
  const sharedContacts = await findRentersSharingContact(appDb, user.operatorId, renter);
  return (
    <>
      <BusinessStillNeededCard renter={renter} />
      <SharedContactNote contacts={sharedContacts} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <div className="flex flex-col gap-4">
          <MoneyAcrossCarsCard renter={renter} data={data} business={business} />
          <CarsOutCard renter={renter} data={data} business={business} clock={props.clock} />
          <LatestNoteCard renter={renter} user={user} />
        </div>
        <div className="flex flex-col gap-4">
          <DriversCard renter={renter} data={data} business={business} />
          <ContactCard renter={renter} />
        </div>
      </div>
    </>
  );
}
