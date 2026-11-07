import type { VehicleStatus } from "@fleetapp/core";

/**
 * The Cars list's filters in plain words (docs/plans/look-and-feel.md, "Cars
 * and Renters pages"), in the address as /cars?status=out. In the workshop
 * holds In service and Off road. Sold and Written off are only offered while
 * there are such cars, so they stay findable.
 */
export const CAR_LIST_FILTERS = [
  "out",
  "available",
  "workshop",
  "sold",
  "written-off",
  "archived",
] as const;
export type CarListFilter = (typeof CAR_LIST_FILTERS)[number];

/** The filter value that shows archived cars instead of current ones. */
export const ARCHIVED_FILTER = "archived" satisfies CarListFilter;
/** The filter for every car in the workshop: in service or off road. */
export const WORKSHOP_FILTER = "workshop" satisfies CarListFilter;

export const CAR_LIST_FILTER_LABELS: Readonly<Record<CarListFilter, string>> = {
  out: "Out",
  available: "Available",
  workshop: "In the workshop",
  sold: "Sold",
  "written-off": "Written off",
  archived: "Archived",
};

/** Offered only while at least one car is in them. */
export const CAR_FILTERS_SHOWN_WHEN_ANY: ReadonlySet<CarListFilter> = new Set([
  "sold",
  "written-off",
]);

/** The statuses of current (not archived) cars each filter shows; archived cars are their own. */
export const CAR_STATUSES_OF: Readonly<
  Record<Exclude<CarListFilter, "archived">, readonly VehicleStatus[]>
> = {
  out: ["rented"],
  available: ["available"],
  workshop: ["in_service", "off_road"],
  sold: ["sold"],
  "written-off": ["written_off"],
};

function isCarListFilter(value: string): value is CarListFilter {
  return CAR_LIST_FILTERS.some((filter) => filter === value);
}

/**
 * The filter an address asks for. Old addresses named the status itself
 * (?status=rented, ?status=in_service); those open the filter that holds it.
 */
export function carListFilterOf(value: string | undefined): CarListFilter | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (isCarListFilter(value)) {
    return value;
  }
  return CAR_LIST_FILTERS.find(
    (filter) =>
      filter !== ARCHIVED_FILTER && CAR_STATUSES_OF[filter].some((status) => status === value),
  );
}

/** How many cars each filter holds, and all current ones, from a count per status. */
export function carListFilterCounts(
  currentByStatus: Partial<Record<VehicleStatus, number>>,
  archived: number,
): Record<CarListFilter | "all", number> {
  const byFilter = Object.fromEntries(
    CAR_LIST_FILTERS.map((filter) => [
      filter,
      filter === ARCHIVED_FILTER
        ? archived
        : CAR_STATUSES_OF[filter].reduce((sum, status) => sum + (currentByStatus[status] ?? 0), 0),
    ]),
  ) as Record<CarListFilter, number>;
  const all = Object.values(currentByStatus).reduce((sum, count) => sum + (count ?? 0), 0);
  return { ...byFilter, all };
}
