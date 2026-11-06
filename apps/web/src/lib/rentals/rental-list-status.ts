import type { RentalStatus } from "@fleetapp/core";
import type { BadgeTone } from "@fleetapp/ui/badge";

/**
 * A rental's status in the Operator's plain words (docs/plans/look-and-feel.md,
 * "Rentals list"): Out (was Active), To close (was Returned). The Rentals
 * list's filters group them: Finished holds Closed and Cancelled, and a
 * cancelled rental still says Cancelled on its badge.
 */

export interface RentalStatusBadge {
  text: string;
  tone: BadgeTone;
}

/** Each status's label, differing in lightness as well as colour (rule 34). */
export const RENTAL_STATUS_BADGES: Readonly<Record<RentalStatus, RentalStatusBadge>> = {
  draft: { text: "Draft", tone: "neutral" },
  booked: { text: "Booked", tone: "booked" },
  active: { text: "Out", tone: "out" },
  returned: { text: "To close", tone: "attention" },
  closed: { text: "Closed", tone: "neutral" },
  cancelled: { text: "Cancelled", tone: "neutral" },
};

/**
 * The list's filters, in the address as plain words (/rentals?status=to-close).
 * A draft holds no car, so it is its own filter rather than hidden in Booked.
 */
export const RENTAL_LIST_STATUSES = ["out", "booked", "draft", "to-close", "finished"] as const;
export type RentalListStatus = (typeof RENTAL_LIST_STATUSES)[number];

export const RENTAL_LIST_STATUS_LABELS: Readonly<Record<RentalListStatus, string>> = {
  out: "Out",
  booked: "Booked",
  draft: "Draft",
  "to-close": "To close",
  finished: "Finished",
};

/** The statuses each filter shows. */
export const RENTAL_STATUSES_OF: Readonly<Record<RentalListStatus, readonly RentalStatus[]>> = {
  out: ["active"],
  booked: ["booked"],
  draft: ["draft"],
  "to-close": ["returned"],
  finished: ["closed", "cancelled"],
};

function isRentalListStatus(value: string): value is RentalListStatus {
  return RENTAL_LIST_STATUSES.some((status) => status === value);
}

/**
 * The filter an address asks for. The old addresses named the status itself
 * (?status=active, ?status=returned); those still open the filter that holds it.
 */
export function rentalListStatusOf(value: string | undefined): RentalListStatus | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (isRentalListStatus(value)) {
    return value;
  }
  return RENTAL_LIST_STATUSES.find((group) =>
    RENTAL_STATUSES_OF[group].some((status) => status === value),
  );
}

/** How many rentals each filter holds, from a count per status. */
export function rentalListStatusCounts(
  counts: Partial<Record<RentalStatus, number>>,
): Record<RentalListStatus, number> {
  return Object.fromEntries(
    RENTAL_LIST_STATUSES.map((group) => [
      group,
      RENTAL_STATUSES_OF[group].reduce((sum, status) => sum + (counts[status] ?? 0), 0),
    ]),
  ) as Record<RentalListStatus, number>;
}
