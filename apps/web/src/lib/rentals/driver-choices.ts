import { firstNameOf, renterDisplayName, renterShownName } from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import { rentals, renters, vehicles } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { driverBadge, driverLicenceWords } from "../renters/driver-standing";
import { selectBusinessDrivers, type BusinessDriver } from "../renters/organisation-driver-queries";
import type { RenterBadge } from "../renters/renter-list-status";
import type { ExpiryContext } from "../vehicles/expiry-columns";

/**
 * One of a business's drivers as the driver picker offers them (mockup 5):
 * their name, licence's kind and expiry (never its number), one standing
 * label, the cars they already have out (a warning, never a refusal), and
 * why they can't be picked yet, if so.
 */
export interface DriverChoice {
  driverId: string;
  name: string;
  licenceWords: string;
  badge: RenterBadge;
  carsOut: string[];
  /** Why they can't be named now (details waiting for review, Do not rent); null when they can. */
  unavailableReason: string | null;
}

/** A business on the New rental form: who signs its contract, and its drivers to pick from. */
export interface BusinessChoice {
  legalName: string;
  shownName: string;
  contactName: string | null;
  drivers: DriverChoice[];
}

/** Why a current driver can't be named yet, in words; null when they can. */
export function driverUnavailableReason(
  driver: Pick<BusinessDriver, "fullName" | "status" | "isWaitingReview" | "isArchived">,
): string | null {
  if (driver.status === "do_not_rent") {
    return "Marked Do not rent, so they can't be named.";
  }
  if (driver.isArchived) {
    return "Archived. Restore them before naming them.";
  }
  return driver.isWaitingReview
    ? `Review the details ${firstNameOf(driver.fullName)} sent before naming them.`
    : null;
}

/** One driver as the picker shows them. Pure. */
export function driverChoiceOf(
  driver: BusinessDriver,
  carsOut: readonly string[],
  expiry: ExpiryContext,
): DriverChoice {
  return {
    driverId: driver.driverId,
    name: renterDisplayName(driver.fullName, driver.preferredName),
    licenceWords: driverLicenceWords(driver),
    badge: driverBadge(driver, expiry),
    carsOut: [...carsOut],
    unavailableReason: driverUnavailableReason(driver),
  };
}

/**
 * Every current business Renter that can book (not archived, not Do not
 * rent), with its current drivers for the New rental form's driver picker:
 * read in the Operator's own tenant context (rules 1 and 2).
 */
export async function listBusinessChoices(
  database: AnyDatabase,
  operatorId: string,
  expiry: ExpiryContext,
  /** Only this business: a rental's page naming its driver. */
  onlyBusinessId?: string,
): Promise<Record<string, BusinessChoice>> {
  return withTenant(database, operatorId, async (tx) => {
    const businesses = await tx
      .select({
        id: renters.id,
        fullName: renters.fullName,
        tradingName: renters.tradingName,
        contactName: renters.contactName,
      })
      .from(renters)
      .where(
        and(
          eq(renters.operatorId, operatorId),
          eq(renters.kind, "organisation"),
          eq(renters.status, "active"),
          isNull(renters.archivedAt),
          onlyBusinessId ? eq(renters.id, onlyBusinessId) : undefined,
        ),
      );
    const drivers = await selectBusinessDrivers(
      tx,
      operatorId,
      businesses.map((business) => business.id),
      { isCurrentOnly: true },
    );
    const driverIds = [...new Set(drivers.map((row) => row.driverId))];
    const carsOut =
      driverIds.length === 0
        ? []
        : await tx
            .select({ driverId: rentals.driverId, rego: vehicles.rego })
            .from(rentals)
            .innerJoin(
              vehicles,
              and(eq(vehicles.id, rentals.vehicleId), eq(vehicles.operatorId, rentals.operatorId)),
            )
            .where(
              and(
                eq(rentals.operatorId, operatorId),
                eq(rentals.status, "active"),
                inArray(rentals.driverId, driverIds),
              ),
            )
            .orderBy(asc(vehicles.rego));
    const regosOf = (driverId: string) =>
      carsOut.filter((car) => car.driverId === driverId).map((car) => car.rego);
    return Object.fromEntries(
      businesses.map((business) => [
        business.id,
        {
          legalName: business.fullName,
          shownName: renterShownName({
            kind: "organisation",
            fullName: business.fullName,
            tradingName: business.tradingName,
            preferredName: null,
          }),
          contactName: business.contactName,
          drivers: drivers
            .filter((row) => row.organisationId === business.id)
            .map((row) => driverChoiceOf(row, regosOf(row.driverId), expiry)),
        },
      ]),
    );
  });
}
