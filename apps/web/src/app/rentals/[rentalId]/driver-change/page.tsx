import type { Metadata } from "next";
import { canChangeDriver, isRecordId, renterShownName } from "@fleetapp/core";
import { withTenant } from "@fleetapp/db/tenant-context";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "../../../app-shell";
import { SectionCard } from "../../../../components/section-card";
import { appDb } from "../../../../lib/app-db";
import { rentalDriverChangePath, rentalPath } from "../../../../lib/paths";
import { listBusinessChoices } from "../../../../lib/rentals/driver-choices";
import { driverChangeUnderWay } from "../../../../lib/rentals/driver-changes";
import { loadRental, rentalRenterNames } from "../../../../lib/rentals/rental-queries";
import { requireUser } from "../../../../lib/require-user";
import { loadExpiryContext } from "../../../../lib/vehicles/expiry-context";
import { startDriverChangeAction } from "./actions";
import { DriverChangeStrip } from "./driver-change-strip";
import { StartDriverChangeForm } from "./start-driver-change-form";

/** Its own tab name: the layout adds the product's (review A10-2). */
export const metadata: Metadata = { title: "Change driver" };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A driver change's first step (mockup 7): who drives the business's car
 * next, and why. A change already under way carries on at its check-in.
 */
export default async function StartDriverChangePage(props: {
  params: Promise<{ rentalId: string }>;
}) {
  const user = await requireUser();
  const { rentalId } = await props.params;
  if (!isRecordId(rentalId)) {
    notFound();
  }
  const clock = { timeZone: user.operatorTimezone, now: new Date() };
  const [rental, underWay] = await Promise.all([
    loadRental(appDb, user.operatorId, rentalId, clock),
    withTenant(appDb, user.operatorId, (tx) => driverChangeUnderWay(tx, user.operatorId, rentalId)),
  ]);
  if (underWay) {
    redirect(rentalDriverChangePath(rentalId, "check-in"));
  }
  if (!rental || !canChangeDriver(rental.status, rental.renterKind) || !rental.driverFullName) {
    redirect(rentalPath(rentalId));
  }
  const expiry = await loadExpiryContext(user, "licenceExpiryWarningDays");
  const business = (await listBusinessChoices(appDb, user.operatorId, expiry, rental.renterId))[
    rental.renterId
  ];
  const drivers = (business?.drivers ?? []).filter((driver) => driver.driverId !== rental.driverId);
  const businessName = renterShownName(rentalRenterNames(rental));
  return (
    <AppShell
      user={user}
      strip={
        <DriverChangeStrip
          rentalId={rentalId}
          carRego={rental.rego}
          businessName={businessName}
          fromName={rental.driverFullName}
          toName={null}
          step={0}
        />
      }
    >
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
        <p className="bg-muted rounded-md p-3 text-sm">
          The car must be here with you. {rental.driverFullName}&apos;s time with {rental.rego} ends
          and the new driver&apos;s starts at the same moment, when they sign, so a fine always
          names who had it.
        </p>
        <SectionCard heading="New driver">
          <div className="pb-4">
            {drivers.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {businessName} has no other driver who can take the car now. Add one on its Drivers
                tab first.
              </p>
            ) : (
              <StartDriverChangeForm
                action={startDriverChangeAction.bind(null, rentalId)}
                carRego={rental.rego}
                businessId={rental.renterId}
                businessName={businessName}
                drivers={drivers}
              />
            )}
          </div>
        </SectionCard>
      </div>
    </AppShell>
  );
}
