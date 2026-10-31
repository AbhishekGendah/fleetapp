import { addMonths } from "./calendar-dates";

/**
 * How long licence scans are kept (docs/plans/phase-2-step-5.md). They are
 * identity documents, the most sensitive thing held about a Renter, so they
 * go once they are no longer needed (APP 11.2).
 */
export const DEFAULT_LICENCE_SCAN_KEPT_MONTHS = 12;
export const MINIMUM_LICENCE_SCAN_KEPT_MONTHS = 1;
/** Matches the 5 years tax records are kept: nothing legitimate needs longer. */
export const MAXIMUM_LICENCE_SCAN_KEPT_MONTHS = 60;

/** The same moment `months` calendar months later (UTC), on the month's last day if shorter. */
export function addMonthsToMoment(moment: Date, months: number): Date {
  const iso = moment.toISOString();
  return new Date(`${addMonths(iso.slice(0, 10), months)}${iso.slice(10)}`);
}

export interface ScanRetentionFacts {
  /** When the scan was added. */
  addedAt: Date;
  /** When the Renter's last rental ended; null if they have not rented. */
  lastRentalEndedAt: Date | null;
}

/**
 * When a scan goes: `keptMonths` after the later of when it was added and
 * when the Renter's last rental ended. Not used while a rental, fine or
 * dispute is open; the caller checks that.
 */
export function licenceScanDeleteAfter(facts: ScanRetentionFacts, keptMonths: number): Date {
  const from =
    facts.lastRentalEndedAt && facts.lastRentalEndedAt > facts.addedAt
      ? facts.lastRentalEndedAt
      : facts.addedAt;
  return addMonthsToMoment(from, keptMonths);
}
