import {
  FUEL_LEVEL_LABELS,
  formatCents,
  formatKilometres,
  formatShortCalendarDate,
  formatShortDayInTimeZone,
  formatTimeInTimeZone,
  todayInTimeZone,
  type BookingProblem,
  type BondMovementKind,
  type FuelLevel,
  type RentalStatus,
} from "@fleetapp/core";

import { RENTAL_STATUS_BADGES, type RentalStatusBadge } from "./rental-list-status";
import type { RentalClock } from "./rental-records";
import { rentalRateOf } from "./rental-labels";

/**
 * The words at the top of one rental's page (docs/plans/look-and-feel.md,
 * "One rental's page"): its status in plain words, the key facts on the navy
 * strip, and the Next step card's ticks and main button. Pure: the page
 * loads the records and these only put them into words.
 */

/** One fact on the navy strip: "Owing $0.00, All paid up". */
export interface RentalFact {
  label: string;
  value: string;
  note?: string;
}

export type RentalStatusWords = RentalStatusBadge;

const TODAY_WORD = "Today";

/** "Today", or the day as a short line reads it: "Fri 6 Nov". */
function dayWords(moment: Date, clock: RentalClock): string {
  const today = todayInTimeZone(clock.now, clock.timeZone);
  return todayInTimeZone(moment, clock.timeZone) === today
    ? TODAY_WORD
    : formatShortDayInTimeZone(moment, clock.timeZone, today);
}

/**
 * The rental's status as the Operator says it: "Booked · handover today",
 * "Out since Fri 6 Nov", "To close" (was Returned).
 */
export function rentalStatusWords(
  rental: { status: RentalStatus; plannedStart: Date; handedOverAt: Date | null },
  clock: RentalClock,
): RentalStatusWords {
  switch (rental.status) {
    case "booked": {
      const day = dayWords(rental.plannedStart, clock);
      return {
        text: `Booked · handover ${day === TODAY_WORD ? "today" : day}`,
        tone: "booked",
      };
    }
    case "active":
      return {
        text: rental.handedOverAt ? `Out since ${dayWords(rental.handedOverAt, clock)}` : "Out",
        tone: "out",
      };
    default:
      return RENTAL_STATUS_BADGES[rental.status];
  }
}

/** When the car is handed over: the day, and the time under it. */
export function handoverFact(plannedStart: Date, clock: RentalClock): RentalFact {
  return {
    label: "Handover",
    value: dayWords(plannedStart, clock),
    note: formatTimeInTimeZone(plannedStart, clock.timeZone),
  };
}

const RATE_PER_WORDS = { day: "a day", week: "a week" } as const;

/** The rent: "$350.00", "a week". Left out when the rental has no rate. */
export function rentFact(rate: Parameters<typeof rentalRateOf>[0]): RentalFact | null {
  const rentalRate = rentalRateOf(rate);
  return rentalRate
    ? { label: "Rent", value: formatCents(rentalRate.cents), note: RATE_PER_WORDS[rentalRate.per] }
    : null;
}

/**
 * The next rent charge, as the rent run will make it (lib/ledger/next-rent):
 * "Next rent $350.00, Fri 13 Nov", or a booking's "First rent", due at the
 * handover.
 */
export function nextRentFact(
  nextRent: { chargedAt: Date; amountCents: number; isFirst: boolean },
  clock: RentalClock,
): RentalFact {
  return {
    label: nextRent.isFirst ? "First rent" : "Next rent",
    value: formatCents(nextRent.amountCents),
    note: dayWords(nextRent.chargedAt, clock),
  };
}

/** What the strip needs to know about the bond: worked out from its entries (bond-account). */
export interface BondFactInput {
  requiredCents: number;
  heldCents: number;
  owingCents: number;
  onItsWayCents: number;
  movements: readonly { id: string; kind: BondMovementKind; reversesId: string | null }[];
  isHandedOver: boolean;
}

function bondNote(bond: BondFactInput): string {
  if (bond.heldCents > 0) {
    if (bond.owingCents > 0) {
      return `${formatCents(bond.owingCents)} still to pay`;
    }
    return bond.isHandedOver ? "Held" : "Paid";
  }
  if (bond.onItsWayCents > 0) {
    return "On its way";
  }
  const reversedIds = new Set(bond.movements.map((movement) => movement.reversesId));
  const standing = bond.movements.filter((movement) => !reversedIds.has(movement.id));
  if (standing.some((movement) => movement.kind === "refunded")) {
    return "Refunded";
  }
  if (standing.some((movement) => movement.kind === "deducted")) {
    return "Kept";
  }
  return "Not paid yet";
}

/** The bond: what is held (or required, before any is), and whether it is paid, held or back. */
export function bondFact(bond: BondFactInput): RentalFact {
  if (bond.requiredCents === 0 && bond.heldCents === 0 && bond.movements.length === 0) {
    return { label: "Bond", value: "None" };
  }
  return {
    label: "Bond",
    value: formatCents(bond.heldCents > 0 ? bond.heldCents : bond.requiredCents),
    note: bondNote(bond),
  };
}

/** What is owing, from the ledger's balance (rule 11), and since when. */
export function owingFact(
  ledger: { balanceCents: number; oldestOwingOn: string | null },
  today: string,
): RentalFact {
  if (ledger.balanceCents < 0) {
    return {
      label: "Owing",
      value: formatCents(0),
      note: `${formatCents(-ledger.balanceCents)} in credit`,
    };
  }
  if (ledger.balanceCents === 0) {
    return { label: "Owing", value: formatCents(0), note: "All paid up" };
  }
  return {
    label: "Owing",
    value: formatCents(ledger.balanceCents),
    ...(ledger.oldestOwingOn
      ? { note: `Since ${formatShortCalendarDate(ledger.oldestOwingOn, today)}` }
      : {}),
  };
}

/** The kilometres (and fuel) at the handover of the car the Renter has now. */
export function atHandoverFact(handover: {
  odometerKm: number | null;
  fuelLevel: FuelLevel | null;
}): RentalFact | null {
  if (handover.odometerKm === null) {
    return null;
  }
  return {
    label: "At handover",
    value: formatKilometres(handover.odometerKm),
    ...(handover.fuelLevel
      ? { note: `Fuel ${FUEL_LEVEL_LABELS[handover.fuelLevel].toLowerCase()}` }
      : {}),
  };
}

/** The problems that are about the Renter themselves, so their details are not yet approved. */
const RENTER_PROBLEM_CODES: ReadonlySet<BookingProblem["code"]> = new Set([
  "do_not_rent",
  "details_missing",
  "business_details_missing",
  "licence_expired_by_start",
  "under_minimum_age",
  "provisional_licence",
]);

/** Whether the Renter's details stand in the way: missing, out of date, or refused by the rules. */
export function hasRenterProblem(problems: readonly BookingProblem[]): boolean {
  return problems.some((problem) => RENTER_PROBLEM_CODES.has(problem.code));
}

/** The Next step card's main button. */
export type NextStepAction =
  | "book"
  | "continue_handover"
  | "start_handover"
  | "send_contract"
  | "take_bond"
  | "name_driver"
  | "check_details";

export interface NextStepInput {
  status: "draft" | "booked";
  isContractSigned: boolean;
  isBondPaid: boolean;
  isDetailsApproved: boolean;
  /** A business's driver is named (decision 2); always so for a person's own rental. */
  isDriverNamed: boolean;
  /** No problem stands in the way (isHandoverAllowed). */
  isHandoverAllowed: boolean;
  isHandoverUnderWay: boolean;
}

export interface NextStep {
  main: NextStepAction;
  /** Start handover is still offered beside a missing thing, so a reason can be given there. */
  canStartHandoverToo: boolean;
}

/**
 * What to do next before the car goes: book a draft; carry on with a
 * handover under way; start it when everything is in; otherwise the first
 * missing thing (contract, bond, a business's driver, the details). A handover is only
 * finished once the contract is signed, so an unsigned contract always
 * comes first.
 */
export function nextStepOf(input: NextStepInput): NextStep {
  if (input.status === "draft") {
    return { main: "book", canStartHandoverToo: false };
  }
  if (input.isHandoverUnderWay) {
    return { main: "continue_handover", canStartHandoverToo: false };
  }
  if (input.isContractSigned && input.isHandoverAllowed) {
    return { main: "start_handover", canStartHandoverToo: false };
  }
  const missing: NextStepAction | null = !input.isContractSigned
    ? "send_contract"
    : !input.isBondPaid
      ? "take_bond"
      : !input.isDriverNamed
        ? "name_driver"
        : !input.isDetailsApproved
          ? "check_details"
          : null;
  if (missing === "name_driver") {
    // Nothing can give the car to nobody: the handover waits for a driver.
    return { main: missing, canStartHandoverToo: false };
  }
  // Everything ticked but something else in the way (a car not insured, say):
  // the handover is where that is given a reason or found to block.
  return missing
    ? { main: missing, canStartHandoverToo: true }
    : { main: "start_handover", canStartHandoverToo: false };
}
