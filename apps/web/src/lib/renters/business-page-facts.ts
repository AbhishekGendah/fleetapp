import type { RentalSummary } from "../rentals/rental-queries";
import type { RentalClock } from "../rentals/rental-records";
import type { RentalFact } from "../rentals/rental-page-facts";
import { rentalWhenWords } from "../rentals/rental-when";
import { midSentence, withYouSinceFact } from "./renter-page-facts";

/**
 * The key facts on a business Renter's navy strip (7 Nov 2026 mockups):
 * how many of its cars are out, its next booking, and since when it has
 * rented with how many drivers. Pure. Its Owing is the person's fact (the
 * sum of its rentals' ledgers, rule 11), labelled "across cars".
 */

/** "3" cars out, with "1 booked, starts Mon 9 Nov" (or "None booked") under it. */
export function carsOutFact(underWay: readonly RentalSummary[], clock: RentalClock): RentalFact {
  const carsOut = underWay.filter((rental) => rental.status === "active").length;
  const booked = underWay.filter((rental) => rental.status === "booked");
  const [next] = booked;
  if (!next) {
    return { label: "Cars out", value: String(carsOut), note: "None booked" };
  }
  return {
    label: "Cars out",
    value: String(carsOut),
    note: `${booked.length} booked, ${midSentence(rentalWhenWords(next, clock).shortText)}`,
  };
}

/** "Sep 2026", "5 rentals · 5 drivers": as a person's, with its drivers counted. */
export function businessSinceFact(
  addedAt: Date,
  counts: { rentals: number; drivers: number },
  timeZone: string,
): RentalFact {
  const fact = withYouSinceFact(addedAt, counts.rentals, timeZone);
  const drivers = counts.drivers === 1 ? "1 driver" : `${counts.drivers} drivers`;
  return { ...fact, note: `${fact.note} · ${drivers}` };
}
