import type { QuickSearchGroup } from "@fleetapp/ui/quick-search";

import { carPath, rentalPath, renterPath } from "../paths";
import { RENTAL_STATUS_BADGES } from "../rentals/rental-list-status";
import type { HeaderSearchFindings } from "./header-search-queries";

/**
 * What the top bar's search found, as its drop-down shows it: Cars, Renters,
 * Rentals, each result a link to its page, and kinds with nothing found left
 * out. Second lines say only what the lists already show: a car's make and
 * model, a Renter's phone, a rental's status.
 */
export function headerSearchGroups(findings: HeaderSearchFindings): QuickSearchGroup[] {
  const groups: QuickSearchGroup[] = [
    {
      label: "Cars",
      items: findings.cars.map((car) => ({
        key: car.id,
        href: carPath(car.id),
        title: car.rego,
        detail: `${car.make} ${car.model}`,
      })),
    },
    {
      label: "Renters",
      items: findings.renters.map((renter) => ({
        key: renter.id,
        href: renterPath(renter.id),
        title: renter.fullName,
        detail: renter.phone ?? "",
      })),
    },
    {
      label: "Rentals",
      items: findings.rentals.map((rental) => ({
        key: rental.id,
        href: rentalPath(rental.id),
        title: `${rental.renterFullName} · ${rental.rego}`,
        detail: RENTAL_STATUS_BADGES[rental.status].text,
      })),
    },
  ];
  return groups.filter((group) => group.items.length > 0);
}
