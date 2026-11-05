/**
 * How long a Renter's records are kept once they stop renting, before their
 * personal details are removed (approved 5 Nov 2026; lawyer to confirm,
 * docs/launch-checklist.md). Seven years covers the tax office's five and
 * the six years a contract claim can be brought (WA and most states).
 */
export const RENTER_RECORDS_KEPT_YEARS = 7;

/** What decides whether a Renter's personal details may be removed now. */
export interface RenterRetentionFacts {
  /** When they were added: the clock for a Renter who never rented. */
  addedAt: Date;
  /** When their last rental came back or was cancelled; null if none ended. */
  lastRentalEndedAt: Date | null;
  /** A booking, or a car out. */
  hasOpenRental: boolean;
  /** Either way: owed by them, or owed to them. */
  balanceCents: number;
  bondHeldCents: number;
  /** Damage not yet repaired or written off, or an insurance claim under way. */
  hasOpenDamageMatter: boolean;
}

/** The moment the records' time is up: seven years after the later of being added and the last rental ending. */
export function renterRecordsKeptUntil(facts: RenterRetentionFacts): Date {
  const from = Math.max(facts.addedAt.getTime(), facts.lastRentalEndedAt?.getTime() ?? 0);
  const until = new Date(from);
  until.setUTCFullYear(until.getUTCFullYear() + RENTER_RECORDS_KEPT_YEARS);
  return until;
}

/**
 * Whether the nightly job may remove this Renter's personal details now.
 * Never while anything is still open between them and the business: a
 * rental, money either way, a bond, or a damage matter.
 */
export function isRenterDueForRetirement(facts: RenterRetentionFacts, now: Date): boolean {
  return !isAnythingStillOpen(facts) && renterRecordsKeptUntil(facts) <= now;
}

/** Whether anything still ties the Renter to the business, so nothing of theirs may go. */
export function isAnythingStillOpen(
  facts: Pick<
    RenterRetentionFacts,
    "hasOpenRental" | "balanceCents" | "bondHeldCents" | "hasOpenDamageMatter"
  >,
): boolean {
  return (
    facts.hasOpenRental ||
    facts.balanceCents !== 0 ||
    facts.bondHeldCents !== 0 ||
    facts.hasOpenDamageMatter
  );
}

/** What a retired Renter is called from then on: a name is required, and this says why it's gone. */
export const RETIRED_RENTER_NAME = "Removed Renter";
