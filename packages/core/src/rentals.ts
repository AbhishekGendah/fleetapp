import { TZDate } from "@date-fns/tz";
import { getISODay } from "date-fns";

import { detailsStillNeeded, ageOn, type DetailNeededBeforeRenting } from "./renters";
import type { LicenceType } from "./driver-licence";
import type { VehicleStatus } from "./vehicles";

/**
 * The rules for rentals (docs/design/04, docs/plans/phase-3.md). Pure: the
 * forms check them as you type and the server checks them again on save;
 * the database holds the same status moves and refuses double bookings.
 */

export const RENTAL_TYPES = ["fixed_term", "ongoing"] as const;
export type RentalType = (typeof RENTAL_TYPES)[number];

export const RENTAL_TYPE_LABELS: Readonly<Record<RentalType, string>> = {
  fixed_term: "Fixed term",
  ongoing: "Ongoing",
};

export const RENTAL_STATUSES = [
  "draft",
  "booked",
  "active",
  "returned",
  "closed",
  "cancelled",
] as const;
export type RentalStatus = (typeof RENTAL_STATUSES)[number];

export const RENTAL_STATUS_LABELS: Readonly<Record<RentalStatus, string>> = {
  draft: "Draft",
  booked: "Booked",
  active: "Active",
  returned: "Returned",
  closed: "Closed",
  cancelled: "Cancelled",
};

/**
 * The only moves a rental can make. A draft holds no car; a booking holds it;
 * it becomes active at the handover, returned at the return, closed once
 * settled. Cancelling is possible only before the car changes hands.
 */
export const RENTAL_STATUS_MOVES: Readonly<Record<RentalStatus, readonly RentalStatus[]>> = {
  draft: ["booked", "cancelled"],
  booked: ["active", "cancelled"],
  active: ["returned"],
  returned: ["closed"],
  closed: [],
  cancelled: [],
};

export function canMoveRental(from: RentalStatus, to: RentalStatus): boolean {
  return RENTAL_STATUS_MOVES[from].includes(to);
}

/** Whether the rental has a car held for it (statuses after a booking, before it is settled or called off). */
export function isHoldingCar(status: RentalStatus): boolean {
  return status === "booked" || status === "active";
}

/** ISO weekdays: Monday is 1, Sunday is 7. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS: Readonly<Record<Weekday, string>> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

/** The weekday a moment falls on, on the Operator's clock (rule 10). */
export function weekdayIn(moment: Date, timeZone: string): Weekday {
  return getISODay(new TZDate(moment, timeZone)) as Weekday;
}

/**
 * The day rent is charged each week: the start's weekday, or the one fixed
 * day the Operator charges everyone on.
 */
export function chargeWeekdayFor(
  plannedStart: Date,
  timeZone: string,
  fixedChargeWeekday: Weekday | null,
): Weekday {
  return fixedChargeWeekday ?? weekdayIn(plannedStart, timeZone);
}

/** A fixed-term rental ends after it starts; an ongoing one has no end until notice is given. */
export function isValidRentalPeriod(type: RentalType, start: Date, end: Date | null): boolean {
  return type === "ongoing" ? end === null : end !== null && end.getTime() > start.getTime();
}

/**
 * Why a car cannot (yet) go to a Renter. Each problem says how far it stops
 * things: "booking" problems refuse the booking outright; "handover" ones
 * allow a booking (with a warning, logged) but stop the car changing hands
 * until fixed; "notice" ones only warn.
 */
export const BOOKING_PROBLEM_LEVELS = ["booking", "handover", "notice"] as const;
export type BookingProblemLevel = (typeof BOOKING_PROBLEM_LEVELS)[number];

export type BookingProblem =
  | { code: "do_not_rent"; level: "booking" }
  | { code: "car_not_rentable"; level: "booking"; carStatus: VehicleStatus }
  | { code: "car_not_ready"; level: "handover"; carStatus: VehicleStatus }
  | { code: "details_missing"; level: "handover"; missing: DetailNeededBeforeRenting[] }
  | { code: "licence_expired_by_start"; level: "handover"; expiresOn: string }
  | { code: "under_minimum_age"; level: "handover"; minimumAge: number }
  | { code: "provisional_licence"; level: "handover" }
  | { code: "bond_short"; level: "handover"; owingCents: number }
  | { code: "licence_expires_during"; level: "notice"; expiresOn: string };

/** A car that has left the fleet can never be booked. */
const CARS_NEVER_RENTABLE: readonly VehicleStatus[] = ["sold", "written_off"];
/** A car being fixed can be booked for later, but not handed over until it is back. */
const CARS_NOT_READY: readonly VehicleStatus[] = ["in_service", "off_road"];

export interface BookingCheckInput {
  renter: {
    status: "active" | "do_not_rent";
    dateOfBirth: string | null;
    residentialAddress: string | null;
    licenceType: LicenceType | null;
    licenceExpiresOn: string | null;
    hasBothLicenceScans: boolean;
  };
  carStatus: VehicleStatus;
  /** The planned start and end, as dates on the Operator's clock (YYYY-MM-DD); no end when ongoing. */
  startDate: string;
  endDate: string | null;
  /** The Operator's today. */
  today: string;
  rules: { minimumRenterAgeYears: number; isProvisionalLicenceAllowed: boolean };
}

/** Everything that stands between this Renter and this car, most serious first. */
export function bookingProblems(input: BookingCheckInput): BookingProblem[] {
  const { renter, carStatus, startDate, endDate, rules } = input;
  const problems: BookingProblem[] = [];
  if (renter.status === "do_not_rent") {
    problems.push({ code: "do_not_rent", level: "booking" });
  }
  if (CARS_NEVER_RENTABLE.includes(carStatus)) {
    problems.push({ code: "car_not_rentable", level: "booking", carStatus });
  }
  if (CARS_NOT_READY.includes(carStatus)) {
    problems.push({ code: "car_not_ready", level: "handover", carStatus });
  }
  const missing = detailsStillNeeded({ ...renter, today: input.today });
  if (missing.length > 0) {
    problems.push({ code: "details_missing", level: "handover", missing });
  }
  const expiresOn = renter.licenceExpiresOn;
  if (expiresOn !== null && expiresOn < startDate) {
    problems.push({ code: "licence_expired_by_start", level: "handover", expiresOn });
  } else if (expiresOn !== null && (endDate === null || expiresOn < endDate)) {
    problems.push({ code: "licence_expires_during", level: "notice", expiresOn });
  }
  if (
    renter.dateOfBirth !== null &&
    ageOn(renter.dateOfBirth, startDate) < rules.minimumRenterAgeYears
  ) {
    problems.push({
      code: "under_minimum_age",
      level: "handover",
      minimumAge: rules.minimumRenterAgeYears,
    });
  }
  if (renter.licenceType === "provisional" && !rules.isProvisionalLicenceAllowed) {
    problems.push({ code: "provisional_licence", level: "handover" });
  }
  return problems;
}

/** Whether a booking can be made at all. */
export function isBookingRefused(problems: readonly BookingProblem[]): boolean {
  return problems.some((problem) => problem.level === "booking");
}

/** Whether the car can change hands now. */
export function isHandoverAllowed(problems: readonly BookingProblem[]): boolean {
  return problems.every((problem) => problem.level === "notice");
}

/** No Australian state licenses a driver younger than this; most rental businesses ask for more. */
export const DEFAULT_MINIMUM_RENTER_AGE_YEARS = 21;
export const MAXIMUM_MINIMUM_RENTER_AGE_YEARS = 30;

/** How a week that is not whole is charged (the first one, or after an early return). */
export const PART_WEEK_CHARGING = ["daily_pro_rata", "full_week"] as const;
export type PartWeekCharging = (typeof PART_WEEK_CHARGING)[number];

export const PART_WEEK_CHARGING_LABELS: Readonly<Record<PartWeekCharging, string>> = {
  daily_pro_rata: "By the day (a seventh of the weekly rate per day)",
  full_week: "As a full week",
};

export const DEFAULT_BOND_HOLD_DAYS = 28;
export const MAXIMUM_BOND_HOLD_DAYS = 90;
export const DEFAULT_ONGOING_NOTICE_DAYS = 7;
export const MAXIMUM_ONGOING_NOTICE_DAYS = 60;
