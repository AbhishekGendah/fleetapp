import { renterShownName, type LicenceType, type RenterStatus } from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import { organisationDrivers, possessions, rentals, renters, vehicles } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import type { PickableRecord } from "@fleetapp/ui/record-picker";
import { aliasedTable, and, asc, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { listPickableRenters } from "../rentals/pickable-records";

/**
 * Who drives for which business Renter (organisation_drivers), read in the
 * Operator's own tenant context (rules 1 and 2). A driver is a person
 * Renter: what the business pages show of them is their name, phone, the
 * licence's kind and expiry (never its number or photos) and the car they
 * have; the business itself never sees more (plan "Legal").
 */

const business = aliasedTable(renters, "business");
const driver = aliasedTable(renters, "driver");

/** True while the person sent details through their link that wait for review. */
const driverWaitsReview = sql<boolean>`exists (
  select 1 from "renter_submissions" "waiting"
  where "waiting"."renter_id" = "driver"."id"
    and "waiting"."operator_id" = "driver"."operator_id"
    and "waiting"."status" = 'waiting'
)`;

/** A draft, booking or car out of the business naming the driver: the link can't be removed then. */
const isNamedOnRental = sql<boolean>`exists (
  select 1 from "rentals" "named"
  where "named"."operator_id" = "organisation_drivers"."operator_id"
    and "named"."renter_id" = "organisation_drivers"."organisation_id"
    and "named"."driver_id" = "organisation_drivers"."driver_id"
    and "named"."status" in ('draft', 'booked', 'active')
)`;

export interface BusinessDriver {
  linkId: string;
  driverId: string;
  fullName: string;
  preferredName: string | null;
  phone: string | null;
  status: RenterStatus;
  isArchived: boolean;
  licenceType: LicenceType | null;
  licenceIssuedIn: string | null;
  licenceCountry: string | null;
  licenceExpiresOn: string | null;
  isWaitingReview: boolean;
  /** Named on a draft, booking or car out of this business: not removable until that ends. */
  isNamedOnRental: boolean;
  addedAt: Date;
  /** Set for a past driver. */
  removedAt: Date | null;
}

/** A car of the business's out now, and who has it. */
export interface DriverCarOut {
  driverId: string;
  rentalId: string;
  vehicleId: string;
  rego: string;
  handedOverAt: Date | null;
}

/**
 * The drivers of these businesses, current first (by name), then past ones
 * (none when `isCurrentOnly`), the latest removed first, each with the
 * business they drive for.
 */
export async function selectBusinessDrivers(
  tx: AnyTransaction,
  operatorId: string,
  organisationIds: readonly string[],
  options: { isCurrentOnly: boolean },
): Promise<(BusinessDriver & { organisationId: string })[]> {
  if (organisationIds.length === 0) {
    return [];
  }
  const drivers = await tx
    .select({
      linkId: organisationDrivers.id,
      organisationId: organisationDrivers.organisationId,
      driverId: organisationDrivers.driverId,
      fullName: driver.fullName,
      preferredName: driver.preferredName,
      phone: driver.phone,
      status: driver.status,
      archivedAt: driver.archivedAt,
      licenceType: driver.licenceType,
      licenceIssuedIn: driver.licenceIssuedIn,
      licenceCountry: driver.licenceCountry,
      licenceExpiresOn: driver.licenceExpiresOn,
      isWaitingReview: driverWaitsReview,
      isNamedOnRental,
      addedAt: organisationDrivers.addedAt,
      removedAt: organisationDrivers.removedAt,
    })
    .from(organisationDrivers)
    .innerJoin(
      driver,
      and(
        eq(driver.id, organisationDrivers.driverId),
        eq(driver.operatorId, organisationDrivers.operatorId),
      ),
    )
    .where(
      and(
        eq(organisationDrivers.operatorId, operatorId),
        inArray(organisationDrivers.organisationId, [...organisationIds]),
        options.isCurrentOnly ? isNull(organisationDrivers.removedAt) : undefined,
      ),
    )
    .orderBy(
      sql`${organisationDrivers.removedAt} is not null`,
      desc(organisationDrivers.removedAt),
      asc(sql`lower(${driver.fullName})`),
    );
  return drivers.map(({ archivedAt, ...row }) => ({ ...row, isArchived: archivedAt !== null }));
}

/**
 * The business's drivers, current first (by name), then past ones, the
 * latest removed first; with the cars of the business each has out now.
 */
export async function listBusinessDrivers(
  database: AnyDatabase,
  operatorId: string,
  organisationId: string,
): Promise<{ drivers: BusinessDriver[]; carsOut: DriverCarOut[] }> {
  return withTenant(database, operatorId, async (tx) => {
    const drivers = await selectBusinessDrivers(tx, operatorId, [organisationId], {
      isCurrentOnly: false,
    });
    const carsOut = await tx
      .select({
        driverId: sql<string>`${rentals.driverId}`,
        rentalId: rentals.id,
        vehicleId: rentals.vehicleId,
        rego: vehicles.rego,
        handedOverAt: rentals.handedOverAt,
      })
      .from(rentals)
      .innerJoin(
        vehicles,
        and(eq(vehicles.id, rentals.vehicleId), eq(vehicles.operatorId, rentals.operatorId)),
      )
      .where(
        and(
          eq(rentals.operatorId, operatorId),
          eq(rentals.renterId, organisationId),
          eq(rentals.status, "active"),
        ),
      );
    return {
      drivers: drivers.map(({ organisationId: _business, ...row }) => row),
      carsOut,
    };
  });
}

/** A business a person drives (or drove) for. */
export interface DrivesFor {
  linkId: string;
  organisationId: string;
  name: string;
  addedAt: Date;
  removedAt: Date | null;
}

/** The businesses a person drives for now (by name), then those they drove for, latest first. */
export async function listDrivesFor(
  database: AnyDatabase,
  operatorId: string,
  driverId: string,
): Promise<DrivesFor[]> {
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        linkId: organisationDrivers.id,
        organisationId: organisationDrivers.organisationId,
        kind: business.kind,
        fullName: business.fullName,
        tradingName: business.tradingName,
        addedAt: organisationDrivers.addedAt,
        removedAt: organisationDrivers.removedAt,
      })
      .from(organisationDrivers)
      .innerJoin(
        business,
        and(
          eq(business.id, organisationDrivers.organisationId),
          eq(business.operatorId, organisationDrivers.operatorId),
        ),
      )
      .where(
        and(
          eq(organisationDrivers.operatorId, operatorId),
          eq(organisationDrivers.driverId, driverId),
        ),
      )
      .orderBy(
        sql`${organisationDrivers.removedAt} is not null`,
        desc(organisationDrivers.removedAt),
        asc(organisationDrivers.addedAt),
      ),
  );
  return rows.map((row) => ({
    linkId: row.linkId,
    organisationId: row.organisationId,
    name: renterShownName({ ...row, preferredName: null }),
    addedAt: row.addedAt,
    removedAt: row.removedAt,
  }));
}

/** One time a person had a car, from the handover they signed to its return or swap. */
export interface CarDriven {
  possessionId: string;
  rentalId: string;
  vehicleId: string;
  rego: string;
  make: string;
  model: string;
  /** The business whose car it was; null for their own rental. */
  businessName: string | null;
  startedAt: Date;
  endedAt: Date | null;
}

/**
 * Every time this person had a car, latest first, from the possession
 * records (rule 15): their own rentals and the businesses' they drove for.
 */
export async function listCarsDriven(
  database: AnyDatabase,
  operatorId: string,
  driverId: string,
): Promise<CarDriven[]> {
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        possessionId: possessions.id,
        rentalId: possessions.rentalId,
        vehicleId: possessions.vehicleId,
        rego: vehicles.rego,
        make: vehicles.make,
        model: vehicles.model,
        renterId: possessions.renterId,
        kind: business.kind,
        fullName: business.fullName,
        tradingName: business.tradingName,
        startedAt: possessions.startedAt,
        endedAt: possessions.endedAt,
      })
      .from(possessions)
      .innerJoin(
        vehicles,
        and(
          eq(vehicles.id, possessions.vehicleId),
          eq(vehicles.operatorId, possessions.operatorId),
        ),
      )
      .innerJoin(
        business,
        and(eq(business.id, possessions.renterId), eq(business.operatorId, possessions.operatorId)),
      )
      .where(and(eq(possessions.operatorId, operatorId), eq(possessions.driverId, driverId)))
      .orderBy(desc(possessions.startedAt)),
  );
  return rows.map(({ renterId, kind, fullName, tradingName, ...row }) => ({
    ...row,
    businessName:
      renterId === driverId
        ? null
        : renterShownName({ kind, fullName, tradingName, preferredName: null }),
  }));
}

/** For a page of Renters: the businesses each currently drives for, by name. */
export async function loadCurrentBusinessesOf(
  database: AnyDatabase,
  operatorId: string,
  driverIds: readonly string[],
): Promise<Map<string, { id: string; name: string }[]>> {
  if (driverIds.length === 0) {
    return new Map();
  }
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        driverId: organisationDrivers.driverId,
        organisationId: organisationDrivers.organisationId,
        kind: business.kind,
        fullName: business.fullName,
        tradingName: business.tradingName,
      })
      .from(organisationDrivers)
      .innerJoin(
        business,
        and(
          eq(business.id, organisationDrivers.organisationId),
          eq(business.operatorId, organisationDrivers.operatorId),
        ),
      )
      .where(
        and(
          eq(organisationDrivers.operatorId, operatorId),
          inArray(organisationDrivers.driverId, [...driverIds]),
          isNull(organisationDrivers.removedAt),
        ),
      )
      .orderBy(asc(organisationDrivers.addedAt)),
  );
  const byDriver = new Map<string, { id: string; name: string }[]>();
  for (const row of rows) {
    const named = {
      id: row.organisationId,
      name: renterShownName({ ...row, preferredName: null }),
    };
    byDriver.set(row.driverId, [...(byDriver.get(row.driverId) ?? []), named]);
  }
  return byDriver;
}

/** The businesses one person drives for now, by name: for their privacy notice. */
export async function loadDrivesForNames(
  database: AnyDatabase,
  operatorId: string,
  driverId: string,
): Promise<string[]> {
  const businesses = await loadCurrentBusinessesOf(database, operatorId, [driverId]);
  return (businesses.get(driverId) ?? []).map((business) => business.name);
}

/** Every driver link this Renter is on, either side, current or past: for their Log. */
export async function listDriverLinkIds(
  database: AnyDatabase,
  operatorId: string,
  renterId: string,
): Promise<string[]> {
  const rows = await withTenant(database, operatorId, (tx) =>
    tx
      .select({ id: organisationDrivers.id })
      .from(organisationDrivers)
      .where(
        and(
          eq(organisationDrivers.operatorId, operatorId),
          or(
            eq(organisationDrivers.organisationId, renterId),
            eq(organisationDrivers.driverId, renterId),
          ),
        ),
      ),
  );
  return rows.map((row) => row.id);
}

/** How many current driver links this Renter is on, either side: a business's drivers, or the businesses a person drives for. */
export async function countCurrentDriverLinks(
  tx: AnyTransaction,
  operatorId: string,
  renterId: string,
): Promise<number> {
  const [row] = await tx
    .select({ total: count() })
    .from(organisationDrivers)
    .where(
      and(
        eq(organisationDrivers.operatorId, operatorId),
        isNull(organisationDrivers.removedAt),
        or(
          eq(organisationDrivers.organisationId, renterId),
          eq(organisationDrivers.driverId, renterId),
        ),
      ),
    );
  return row?.total ?? 0;
}

/**
 * The people who could be added as this business's driver: the Operator's
 * current person Renters who are not marked Do not rent (as the New rental
 * form offers them) and are not already its drivers, by name.
 */
export function listDriverCandidates(
  database: AnyDatabase,
  operatorId: string,
  organisationId: string,
): Promise<PickableRecord[]> {
  return listPickableRenters(database, operatorId, {
    isPeopleOnly: true,
    alsoMatching: sql`not exists (
      select 1 from "organisation_drivers" "current"
      where "current"."operator_id" = "renters"."operator_id"
        and "current"."driver_id" = "renters"."id"
        and "current"."organisation_id" = ${organisationId}
        and "current"."removed_at" is null
    )`,
  });
}
