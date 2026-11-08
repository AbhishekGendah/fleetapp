import { normaliseRego, renterShownName, type ListQuery, type RentalStatus } from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import { listConditions, listOrderBy, type DatabaseListRules } from "@fleetapp/db/list-query";
import { rentals, renters, vehicles } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, ilike, isNull, or, type SQL } from "drizzle-orm";

import {
  CAR_OF_RENTAL,
  RELEVANCE_ORDER,
  RENTAL_LIST_RULES,
  RENTER_OF_RENTAL,
} from "../rentals/rental-queries";
import { RENTER_LIST_RULES } from "../renters/renter-queries";
import { VEHICLE_LIST_RULES } from "../vehicles/vehicle-queries";
import { HEADER_SEARCH_GROUP_SIZE } from "./header-search-limits";

export interface FoundCar {
  id: string;
  rego: string;
  make: string;
  model: string;
}

export interface FoundRenter {
  id: string;
  /** A business by its trading name; a person by their name. */
  shownName: string;
  /** A person's phone; a business's legal name when it trades by another. */
  detail: string;
}

export interface FoundRental {
  id: string;
  status: RentalStatus;
  /** A business by its trading name. */
  renterShownName: string;
  rego: string;
}

export interface HeaderSearchFindings {
  cars: FoundCar[];
  renters: FoundRenter[];
  rentals: FoundRental[];
}

/** The text as each list's own search takes it, word by word, sorted as that list is. */
function searchedAs(text: string, sortColumn: string): ListQuery {
  return { search: text, sort: { column: sortColumn, direction: "asc" }, filters: {}, page: 1 };
}

/**
 * The words matched the way the list matches them, or the text as a rego:
 * "1abc-234" finds 1ABC234 though no word of it is in the rego. A rego holds
 * only letters and digits, so the pattern needs no escaping.
 */
function matchesListOrRego(
  rules: DatabaseListRules,
  query: ListQuery,
  rego: typeof vehicles.rego,
): SQL | undefined {
  const typedRego = normaliseRego(query.search);
  const listMatch = listConditions(rules, query);
  return typedRego.length > 0 ? or(listMatch, ilike(rego, `%${typedRego}%`)) : listMatch;
}

/**
 * A few of the Operator's cars, Renters and rentals matching what was typed
 * in the top bar, each kind matched by its own list's search (cars by rego,
 * make, model; Renters by name and phone, spaces or not, a business by its
 * trading name and ABN too; rentals by the Renter's or driver's name or the
 * rego) and in that list's order. Archived cars and
 * Renters are left out, as their lists leave them out until asked for.
 * The text reaches Postgres only as parameters; it is never logged.
 */
export async function searchOperatorRecords(
  database: AnyDatabase,
  operatorId: string,
  text: string,
): Promise<HeaderSearchFindings> {
  const carQuery = searchedAs(text, "rego");
  const renterQuery = searchedAs(text, "name");
  const rentalQuery = searchedAs(text, RELEVANCE_ORDER);

  return withTenant(database, operatorId, async (tx) => {
    const cars = await tx
      .select({ id: vehicles.id, rego: vehicles.rego, make: vehicles.make, model: vehicles.model })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.operatorId, operatorId),
          isNull(vehicles.archivedAt),
          matchesListOrRego(VEHICLE_LIST_RULES, carQuery, vehicles.rego),
        ),
      )
      .orderBy(...listOrderBy(VEHICLE_LIST_RULES, carQuery))
      .limit(HEADER_SEARCH_GROUP_SIZE);

    const foundRenters = await tx
      .select({
        id: renters.id,
        kind: renters.kind,
        fullName: renters.fullName,
        preferredName: renters.preferredName,
        tradingName: renters.tradingName,
        phone: renters.phone,
      })
      .from(renters)
      .where(
        and(
          eq(renters.operatorId, operatorId),
          isNull(renters.archivedAt),
          listConditions(RENTER_LIST_RULES, renterQuery),
        ),
      )
      .orderBy(...listOrderBy(RENTER_LIST_RULES, renterQuery))
      .limit(HEADER_SEARCH_GROUP_SIZE);

    const foundRentals = await tx
      .select({
        id: rentals.id,
        status: rentals.status,
        renterKind: renters.kind,
        renterFullName: renters.fullName,
        renterTradingName: renters.tradingName,
        rego: vehicles.rego,
      })
      .from(rentals)
      .innerJoin(renters, RENTER_OF_RENTAL)
      .innerJoin(vehicles, CAR_OF_RENTAL)
      .where(
        and(
          eq(rentals.operatorId, operatorId),
          matchesListOrRego(RENTAL_LIST_RULES, rentalQuery, vehicles.rego),
        ),
      )
      .orderBy(...listOrderBy(RENTAL_LIST_RULES, rentalQuery))
      .limit(HEADER_SEARCH_GROUP_SIZE);

    return {
      cars,
      renters: foundRenters.map((renter) => ({
        id: renter.id,
        shownName: renterShownName(renter),
        detail:
          renter.kind === "organisation" && renter.tradingName
            ? renter.fullName
            : (renter.phone ?? ""),
      })),
      rentals: foundRentals.map(({ renterKind, renterFullName, renterTradingName, ...rental }) => ({
        ...rental,
        renterShownName: renterShownName({
          kind: renterKind,
          fullName: renterFullName,
          tradingName: renterTradingName,
          preferredName: null,
        }),
      })),
    };
  });
}
