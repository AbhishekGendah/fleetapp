import {
  formatShortDayInTimeZone,
  formatTimeInTimeZone,
  todayInTimeZone,
  type RentalStatus,
} from "@fleetapp/core";

import type { RentalClock } from "./rental-records";

/**
 * The Rentals list's When column (docs/plans/look-and-feel.md, "Rentals
 * list"): one line saying what matters about a rental's dates now, on the
 * Operator's clock (rule 10). Pure.
 */

export interface RentalWhenInput {
  status: RentalStatus;
  plannedStart: Date;
  plannedEnd: Date | null;
  handedOverAt: Date | null;
  returnedAt: Date | null;
}

export interface RentalWhenWords {
  /** For the table on a computer: "Fri 9 Oct to Tue 10 Nov". */
  text: string;
  /** For a phone's card, where a rental out says only when it is back: "Back Tue 10 Nov". */
  shortText: string;
}

const TODAY_WORD = "today";

function same(text: string): RentalWhenWords {
  return { text, shortText: text };
}

/** "today", or the day as a short line reads it: "Sat 7 Nov". */
export function dayOf(moment: Date, clock: RentalClock): string {
  const today = todayInTimeZone(clock.now, clock.timeZone);
  return todayInTimeZone(moment, clock.timeZone) === today
    ? TODAY_WORD
    : formatShortDayInTimeZone(moment, clock.timeZone, today);
}

/** "Fri 9 Oct to Tue 10 Nov", or "From Fri 9 Oct" with no end. */
function spanOf(from: Date, until: Date | null, clock: RentalClock): string {
  const today = todayInTimeZone(clock.now, clock.timeZone);
  const start = formatShortDayInTimeZone(from, clock.timeZone, today);
  return until
    ? `${start} to ${formatShortDayInTimeZone(until, clock.timeZone, today)}`
    : `From ${start}`;
}

function startsWords(rental: RentalWhenInput, clock: RentalClock): RentalWhenWords {
  const time = formatTimeInTimeZone(rental.plannedStart, clock.timeZone);
  return same(`Starts ${dayOf(rental.plannedStart, clock)}, ${time}`);
}

function outWords(rental: RentalWhenInput, clock: RentalClock): RentalWhenWords {
  const since = rental.handedOverAt ?? rental.plannedStart;
  const end = rental.plannedEnd;
  if (!end) {
    return same(`Since ${dayOf(since, clock)}, ongoing`);
  }
  const endDay = dayOf(end, clock);
  if (endDay === TODAY_WORD) {
    return same(`Back today ${formatTimeInTimeZone(end, clock.timeZone)}`);
  }
  if (end < clock.now) {
    return same(`Was due back ${endDay}`);
  }
  return { text: spanOf(since, end, clock), shortText: `Back ${endDay}` };
}

export function rentalWhenWords(rental: RentalWhenInput, clock: RentalClock): RentalWhenWords {
  switch (rental.status) {
    case "draft":
    case "booked":
      return startsWords(rental, clock);
    case "active":
      return outWords(rental, clock);
    case "returned": {
      const back = rental.returnedAt ?? rental.plannedEnd ?? rental.plannedStart;
      return same(`Returned ${dayOf(back, clock)}`);
    }
    case "closed":
      return same(
        spanOf(
          rental.handedOverAt ?? rental.plannedStart,
          rental.returnedAt ?? rental.plannedEnd,
          clock,
        ),
      );
    case "cancelled":
      return same(spanOf(rental.plannedStart, rental.plannedEnd, clock));
  }
}
