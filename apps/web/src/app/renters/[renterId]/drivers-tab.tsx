import {
  formatShortDayInTimeZone,
  renterDisplayName,
  renterShownName,
  todayInTimeZone,
} from "@fleetapp/core";
import { ActionButton } from "@fleetapp/ui/action-button";
import { cn } from "@fleetapp/ui/cn";
import { InlineRecordLink, ROW_CLASSES, RowLink } from "@fleetapp/ui/row-link";
import { UserMinus } from "lucide-react";
import Link from "next/link";

import { SectionCard } from "../../../components/section-card";
import { appDb } from "../../../lib/app-db";
import { carPath, renterPath } from "../../../lib/paths";
import type { SignedInUser } from "../../../lib/require-user";
import { driverBadge, driverLicenceWords } from "../../../lib/renters/driver-standing";
import {
  listDriverCandidates,
  type BusinessDriver,
  type DriverCarOut,
} from "../../../lib/renters/organisation-driver-queries";
import type { RenterDetail } from "../../../lib/renters/renter-queries";
import type { ExpiryContext } from "../../../lib/vehicles/expiry-columns";
import { CARD_ROW_CLASSES } from "../../rentals/rental-row";
import { RenterBadges } from "../renter-list";
import { LazyAddDriverForm } from "./lazy-add-driver-form";
import type { BusinessPageData } from "./business-page-data";
import { addDriverAction, removeDriverAction } from "./driver-actions";
import { QUIET_LINE_CLASSES } from "./card-lines";

/** "Has a car out", "On a booking": why Remove is not offered for this driver. */
function whyNotRemovable(driver: BusinessDriver, car: DriverCarOut | undefined): string | null {
  if (car) {
    return "Has a car out";
  }
  return driver.isNamedOnRental ? "On a booking" : null;
}

/**
 * One current driver as a row (a card on a phone): their name opens their
 * page from anywhere on the row; the licence's kind and expiry (never its
 * number), the car they have, when they were added, and Remove, offered only
 * while no draft, booking or car out of the business names them.
 */
function DriverRow(props: {
  organisationId: string;
  driver: BusinessDriver;
  car: DriverCarOut | undefined;
  expiry: ExpiryContext;
  timeZone: string;
  isEditable: boolean;
}) {
  const { driver, car } = props;
  const name = renterDisplayName(driver.fullName, driver.preferredName);
  const today = todayInTimeZone(new Date(), props.timeZone);
  const notRemovable = whyNotRemovable(driver, car);
  return (
    <li className={cn(ROW_CLASSES, CARD_ROW_CLASSES, "flex-wrap md:flex-nowrap")}>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 md:basis-1/4">
        <RowLink asChild className="text-teal font-extrabold">
          <Link href={renterPath(driver.driverId)}>{name}</Link>
        </RowLink>
        {driver.phone ? (
          <span className="text-muted-foreground text-xs tabular-nums">{driver.phone}</span>
        ) : null}
      </span>
      <span className="flex min-w-0 flex-col items-start gap-1 text-sm md:basis-1/4">
        <span className="text-muted-foreground">{driverLicenceWords(driver)}</span>
        <RenterBadges badges={[driverBadge(driver, props.expiry)]} />
      </span>
      <span className="flex min-w-0 flex-col text-sm md:basis-1/5">
        {car ? (
          <>
            <InlineRecordLink asChild>
              <Link href={carPath(car.vehicleId)}>{car.rego}</Link>
            </InlineRecordLink>
            {car.handedOverAt ? (
              <span className="text-muted-foreground text-xs">
                Since {formatShortDayInTimeZone(car.handedOverAt, props.timeZone, today)}
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-muted-foreground">Not driving now</span>
        )}
      </span>
      <span className="text-muted-foreground text-sm md:basis-1/6">
        Added {formatShortDayInTimeZone(driver.addedAt, props.timeZone, today)}
      </span>
      {props.isEditable ? (
        <span className="relative z-10 flex md:basis-1/6 md:justify-end">
          {notRemovable ? (
            <span className="text-muted-foreground text-sm">{notRemovable}</span>
          ) : (
            <ActionButton
              action={removeDriverAction.bind(null, props.organisationId, driver.driverId)}
              label="Remove"
              pendingLabel="Removing…"
              variant="outline"
              icon={<UserMinus aria-hidden />}
              confirm={{
                title: `Remove ${name} as a driver?`,
                description: `${name} can no longer be named on this business's cars. Their record, and the rentals they drove, stay as they are. You can add them again later.`,
                confirmLabel: "Yes, remove",
              }}
            />
          )}
        </span>
      ) : null}
    </li>
  );
}

/** Drivers who stopped driving for the business, newest first: when, and who removed them. */
function PastDriversCard(props: { drivers: readonly BusinessDriver[]; timeZone: string }) {
  if (props.drivers.length === 0) {
    return null;
  }
  const today = todayInTimeZone(new Date(), props.timeZone);
  const dayOf = (moment: Date) => formatShortDayInTimeZone(moment, props.timeZone, today);
  return (
    <SectionCard heading="Past drivers">
      <ul aria-label="Past drivers">
        {props.drivers.map((driver) => (
          <li key={driver.linkId} className={cn(ROW_CLASSES, CARD_ROW_CLASSES)}>
            <span className="flex min-w-0 flex-1 flex-col">
              <RowLink asChild className="text-teal font-extrabold">
                <Link href={renterPath(driver.driverId)}>
                  {renterDisplayName(driver.fullName, driver.preferredName)}
                </Link>
              </RowLink>
              <span className="text-muted-foreground text-sm">
                {dayOf(driver.addedAt)} to {driver.removedAt ? dayOf(driver.removedAt) : "now"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

/**
 * A business Renter's Drivers tab (7 Nov 2026 mockups): who can be named on
 * its cars, each with their licence's standing and the car they have; then
 * Add a driver and the drivers it had before. The business never sees a
 * driver's licence through the app; these pages are the Operator's own.
 */
export async function DriversTab(props: {
  renter: RenterDetail;
  business: BusinessPageData;
  expiry: ExpiryContext;
  user: SignedInUser;
}) {
  const { renter, business, user } = props;
  const isEditable = renter.archivedAt === null;
  const businessName = renterShownName(renter);
  const candidates = isEditable
    ? await listDriverCandidates(appDb, user.operatorId, renter.id)
    : [];
  return (
    <div className="flex flex-col gap-4">
      <SectionCard heading={`Drivers for ${businessName}`}>
        <p className="text-muted-foreground border-t py-3 text-sm">
          Only these people can be named on {businessName}&rsquo;s cars. A driver can&rsquo;t be
          removed while named on a booked or out car. {businessName} never sees a driver&rsquo;s
          licence.
        </p>
        <ul aria-label="Current drivers">
          {business.currentDrivers.map((driver) => (
            <DriverRow
              key={driver.linkId}
              organisationId={renter.id}
              driver={driver}
              car={business.carsOut.find((out) => out.driverId === driver.driverId)}
              expiry={props.expiry}
              timeZone={user.operatorTimezone}
              isEditable={isEditable}
            />
          ))}
          {business.currentDrivers.length === 0 ? (
            <li className={QUIET_LINE_CLASSES}>No drivers yet.</li>
          ) : null}
        </ul>
      </SectionCard>
      {isEditable ? (
        <SectionCard heading="Add a driver">
          <div className="border-t py-3">
            <LazyAddDriverForm
              businessName={businessName}
              candidates={candidates}
              today={todayInTimeZone(new Date(), user.operatorTimezone)}
              action={addDriverAction.bind(null, renter.id)}
            />
          </div>
        </SectionCard>
      ) : null}
      <PastDriversCard drivers={business.pastDrivers} timeZone={user.operatorTimezone} />
    </div>
  );
}
