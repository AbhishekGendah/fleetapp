import type { DirectDebitState } from "./direct-debits";
import { TZDate } from "@date-fns/tz";
import { getISODay } from "date-fns";

import {
  detailsStillNeeded,
  ageOn,
  type DetailNeededBeforeRenting,
  type RenterStatus,
} from "./renters";
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
  /** The car is still with the Renter of another rental (review A6-3). */
  | { code: "car_still_out"; level: "handover" }
  /** No insurance policy covering the car on the day it goes (review A8-2). */
  | { code: "no_insurance"; level: "handover"; coverOn: string }
  /** No rego covering the car on the day it goes (review A8-2). */
  | { code: "no_rego"; level: "handover"; coverOn: string }
  | { code: "details_missing"; level: "handover"; missing: DetailNeededBeforeRenting[] }
  | { code: "licence_expired_by_start"; level: "handover"; expiresOn: string }
  | { code: "under_minimum_age"; level: "handover"; minimumAge: number }
  | { code: "provisional_licence"; level: "handover" }
  | {
      code: "bond_short";
      level: "handover";
      owingCents: number;
      /** Bond paid by bank debit that hasn't cleared: named, never counted as held (review A5-2). */
      onItsWayCents: number;
    }
  | { code: "direct_debit_missing"; level: "handover"; state: DirectDebitState }
  | { code: "licence_expires_during"; level: "notice"; expiresOn: string };

/**
 * The handover problems the Operator can override with a reason kept with
 * the handover: bond not yet in full, no working direct debit, and
 * insurance or rego not in the app (a business may not keep them here).
 */
export const OVERRIDABLE_HANDOVER_PROBLEMS: ReadonlySet<BookingProblem["code"]> = new Set([
  "bond_short",
  "direct_debit_missing",
  "no_insurance",
  "no_rego",
]);

/** A car that has left the fleet can never be booked. */
const CARS_NEVER_RENTABLE: readonly VehicleStatus[] = ["sold", "written_off"];
/** A car being fixed can be booked for later, but not handed over until it is back. */
const CARS_NOT_READY: readonly VehicleStatus[] = ["in_service", "off_road"];

/** What the Renter (who pays and signs the contract) must be to book: not Do not rent. */
export interface RenterCheckFacts {
  status: RenterStatus;
}

/**
 * What the driver (who has the car) must hold: the licence, age and
 * details checks. For a person Renter, the Renter themselves.
 */
export interface DriverCheckFacts {
  status: RenterStatus;
  dateOfBirth: string | null;
  residentialAddress: string | null;
  licenceType: LicenceType | null;
  licenceExpiresOn: string | null;
  hasBothLicenceScans: boolean;
}

/** The dates and the rental's rules a driver is checked against. */
export interface DriverCheckTerms {
  /** The planned start and end, as dates on the Operator's clock (YYYY-MM-DD); no end when ongoing. */
  startDate: string;
  endDate: string | null;
  /** The Operator's today. */
  today: string;
  rules: { minimumRenterAgeYears: number; isProvisionalLicenceAllowed: boolean };
}

export interface BookingCheckInput extends DriverCheckTerms {
  renter: RenterCheckFacts;
  /** Who drives: for a person Renter, the same person as `renter`. */
  driver: DriverCheckFacts;
  carStatus: VehicleStatus;
  /**
   * What is known about the car on the day it goes (`coverOn`): whether it
   * is still out with another Renter, and its insurance and rego.
   */
  car: { isOutWithAnotherRenter: boolean; isInsured: boolean; isRegistered: boolean };
  /** The day the car's insurance and rego must cover (YYYY-MM-DD). */
  coverOn: string;
}

const DO_NOT_RENT: BookingProblem = { code: "do_not_rent", level: "booking" };

/** What stops this Renter booking whoever drives: marked Do not rent. */
export function renterProblems(renter: RenterCheckFacts): BookingProblem[] {
  return renter.status === "do_not_rent" ? [DO_NOT_RENT] : [];
}

/**
 * What stands between this driver and the car for these dates, most serious
 * first: Do not rent, then details, licence, age and licence type.
 */
export function driverProblems(
  driver: DriverCheckFacts,
  terms: DriverCheckTerms,
): BookingProblem[] {
  const { startDate, endDate, rules } = terms;
  const problems: BookingProblem[] = driver.status === "do_not_rent" ? [DO_NOT_RENT] : [];
  const missing = detailsStillNeeded({ ...driver, today: terms.today });
  if (missing.length > 0) {
    problems.push({ code: "details_missing", level: "handover", missing });
  }
  const expiresOn = driver.licenceExpiresOn;
  if (expiresOn !== null && expiresOn < startDate) {
    problems.push({ code: "licence_expired_by_start", level: "handover", expiresOn });
  } else if (expiresOn !== null && (endDate === null || expiresOn < endDate)) {
    problems.push({ code: "licence_expires_during", level: "notice", expiresOn });
  }
  if (
    driver.dateOfBirth !== null &&
    ageOn(driver.dateOfBirth, startDate) < rules.minimumRenterAgeYears
  ) {
    problems.push({
      code: "under_minimum_age",
      level: "handover",
      minimumAge: rules.minimumRenterAgeYears,
    });
  }
  if (driver.licenceType === "provisional" && !rules.isProvisionalLicenceAllowed) {
    problems.push({ code: "provisional_licence", level: "handover" });
  }
  return problems;
}

/** The car's own problems: one that has left the fleet or is being fixed. */
function carStatusProblems(carStatus: VehicleStatus): BookingProblem[] {
  if (CARS_NEVER_RENTABLE.includes(carStatus)) {
    return [{ code: "car_not_rentable", level: "booking", carStatus }];
  }
  return CARS_NOT_READY.includes(carStatus)
    ? [{ code: "car_not_ready", level: "handover", carStatus }]
    : [];
}

/** The car's own problems on the day it goes: still out, or not insured or registered. */
function carProblems(input: Pick<BookingCheckInput, "car" | "coverOn">): BookingProblem[] {
  const { car, coverOn } = input;
  return [
    ...(car.isOutWithAnotherRenter ? [{ code: "car_still_out", level: "handover" } as const] : []),
    ...(car.isInsured ? [] : [{ code: "no_insurance", level: "handover", coverOn } as const]),
    ...(car.isRegistered ? [] : [{ code: "no_rego", level: "handover", coverOn } as const]),
  ];
}

/**
 * Everything that stands between this Renter, their driver and this car,
 * most serious first. Do not rent is said once, whether the Renter or the
 * driver (or, for a person, both: the same one) is marked.
 */
export function bookingProblems(input: BookingCheckInput): BookingProblem[] {
  const fromDriver = driverProblems(input.driver, input);
  const isDoNotRent = [...renterProblems(input.renter), ...fromDriver].some(
    (problem) => problem.code === "do_not_rent",
  );
  return [
    ...(isDoNotRent ? [DO_NOT_RENT] : []),
    ...carStatusProblems(input.carStatus),
    ...carProblems(input),
    ...fromDriver.filter((problem) => problem.code !== "do_not_rent"),
  ];
}

/** Whether a booking can be made at all. */
export function isBookingRefused(problems: readonly BookingProblem[]): boolean {
  return problems.some((problem) => problem.level === "booking");
}

/** Whether the car can change hands now (overridable problems still need their reason). */
export function isHandoverAllowed(problems: readonly BookingProblem[]): boolean {
  return problems.every((problem) => problem.level === "notice");
}

/**
 * What stops the car changing hands whatever the Operator types: every
 * booking and handover problem except those overridden with a reason. Shared
 * by the handover page and the server so they cannot differ (review A6-1).
 */
export function handoverBlockers(problems: readonly BookingProblem[]): BookingProblem[] {
  return problems.filter(
    (problem) => problem.level !== "notice" && !OVERRIDABLE_HANDOVER_PROBLEMS.has(problem.code),
  );
}

/** No Australian state licenses a driver younger than this; most rental businesses ask for more. */
export const DEFAULT_MINIMUM_RENTER_AGE_YEARS = 21;
export const MAXIMUM_MINIMUM_RENTER_AGE_YEARS = 30;

/** How a week that is not whole is charged (the first one, or after an early return). */
export const PART_WEEK_CHARGING = ["daily_pro_rata", "full_week"] as const;
export type PartWeekCharging = (typeof PART_WEEK_CHARGING)[number];

export const DEFAULT_BOND_HOLD_DAYS = 28;
export const MAXIMUM_BOND_HOLD_DAYS = 90;
export const DEFAULT_ONGOING_NOTICE_DAYS = 7;
export const MAXIMUM_ONGOING_NOTICE_DAYS = 60;
