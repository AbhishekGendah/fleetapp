import { dailyShares, DAYS_PER_WEEK } from "./ledger";
import { gstIncludedIn } from "./money";
import { MILLISECONDS_PER_DAY, MILLISECONDS_PER_MINUTE } from "./time-units";

/**
 * Rent in 24-hour blocks from the handover (docs/plans/review-fixes-batch-1.md).
 * A block is an exact 24 hours from the moment the Renter signed for the car
 * (rule 15), so the business's timezone and daylight saving never change what
 * is owed. Long-term rentals are charged a week (seven blocks) at a time in
 * advance; a short hire pays its booked blocks at the handover and then each
 * extra block as it starts.
 */
export const BLOCK_MILLISECONDS = MILLISECONDS_PER_DAY;

/**
 * How a rental's rent is worked out: `blocks` for every rental booked from
 * the rent rework on, `weekday` for the test rentals made before it, which
 * the rent run no longer charges (batch 1 plan, decision 5).
 */
export const RENT_MODELS = ["weekday", "blocks"] as const;
export type RentModel = (typeof RENT_MODELS)[number];

export const DEFAULT_GRACE_MINUTES = 60;
export const MAXIMUM_GRACE_MINUTES = 240;
export const DEFAULT_LONG_TERM_MINIMUM_DAYS = 7;
export const MAXIMUM_LONG_TERM_MINIMUM_DAYS = 90;

/** A rental's price from one block on. Long-term rentals change only at a week start. */
export interface BlockRate {
  fromBlock: number;
  dailyRateCents: number;
  /** The long-term price for seven blocks; none means seven times the daily rate. */
  weeklyRateCents: number | null;
}

/** What a rental keeps from when it was booked (rule 14) that rent depends on. */
export interface BlockRentTerms {
  isLongTerm: boolean;
  graceMinutes: number;
  longTermMinimumDays: number;
  /** The blocks booked: a short hire pays these at the handover. */
  bookedBlocks: number;
  rates: readonly BlockRate[];
  /** Set when the business waived the daily-rate re-pricing at the return. */
  isDailyRateWaived: boolean;
}

/** One stretch of blocks charged as one line: blocks `firstBlock` up to (not including) `endBlock`. */
export interface BlockPeriod {
  firstBlock: number;
  endBlock: number;
}

/** When a block starts. */
export function blockStartsAt(handedOverAt: Date, block: number): Date {
  return new Date(handedOverAt.getTime() + block * BLOCK_MILLISECONDS);
}

/** Which block a moment falls in (the handover moment is block 0). */
export function blockAt(handedOverAt: Date, moment: Date): number {
  return Math.floor((moment.getTime() - handedOverAt.getTime()) / BLOCK_MILLISECONDS);
}

/**
 * The blocks a stretch of time uses, at least one. Minutes past the last
 * whole block within the grace period are free: 168 hours and 59 minutes
 * is 7 blocks with a 60-minute grace, 169 hours and a half is 8.
 */
export function blocksBetween(from: Date, to: Date, graceMinutes: number): number {
  const chargeableMilliseconds =
    to.getTime() - from.getTime() - graceMinutes * MILLISECONDS_PER_MINUTE;
  return Math.max(1, Math.ceil(chargeableMilliseconds / BLOCK_MILLISECONDS));
}

/** Whether a rental counts as long-term: ongoing, or booked for at least the minimum. */
export function isLongTermBooking(bookedBlocks: number | null, minimumDays: number): boolean {
  return bookedBlocks === null || bookedBlocks >= minimumDays;
}

/** The rate in force for a block: the latest one starting at or before it. */
export function rateForBlock(rates: readonly BlockRate[], block: number): BlockRate {
  const byStart = [...rates].sort((first, second) => first.fromBlock - second.fromBlock);
  const inForce = byStart.filter((rate) => rate.fromBlock <= block).at(-1) ?? byStart[0];
  if (!inForce) {
    throw new RangeError("A rental always has a rate.");
  }
  return inForce;
}

/** One block's rent: a seventh of the weekly price (odd cents to the first days), or the daily rate. */
function blockCents(rate: BlockRate, block: number, isAtDailyRate: boolean): number {
  if (isAtDailyRate || rate.weeklyRateCents === null) {
    return rate.dailyRateCents;
  }
  return dailyShares(rate.weeklyRateCents)[block % DAYS_PER_WEEK] ?? 0;
}

/** The rent for the blocks of a period, each at the rate in force on it. */
export function rentForBlocks(
  terms: BlockRentTerms,
  period: BlockPeriod,
  isAtDailyRate = !terms.isLongTerm,
): number {
  let total = 0;
  for (let block = period.firstBlock; block < period.endBlock; block += 1) {
    total += blockCents(rateForBlock(terms.rates, block), block, isAtDailyRate);
  }
  return total;
}

/** The period a block is charged in. */
export function periodOfBlock(terms: BlockRentTerms, block: number): BlockPeriod {
  if (terms.isLongTerm) {
    const firstBlock = block - (block % DAYS_PER_WEEK);
    return { firstBlock, endBlock: firstBlock + DAYS_PER_WEEK };
  }
  const booked = Math.max(1, terms.bookedBlocks);
  return block < booked
    ? { firstBlock: 0, endBlock: booked }
    : { firstBlock: block, endBlock: block + 1 };
}

/** Where rent stands: the car out until now, or back after `blocksUsed` blocks. */
export interface RentProgress {
  /** The block the run has reached: every period starting at or before it is due. */
  currentBlock: number;
  /** Set once the car is back. */
  blocksUsed: number | null;
}

/**
 * The periods due, oldest first: each has started, and (once the car is
 * back) began before the return. Charged in advance on their first block.
 */
export function duePeriods(terms: BlockRentTerms, progress: RentProgress): BlockPeriod[] {
  const periods: BlockPeriod[] = [];
  const isDue = (firstBlock: number) =>
    firstBlock <= progress.currentBlock &&
    (progress.blocksUsed === null || firstBlock < progress.blocksUsed);
  for (let period = periodOfBlock(terms, 0); isDue(period.firstBlock);) {
    periods.push(period);
    period = periodOfBlock(terms, period.endBlock);
  }
  return periods;
}

/**
 * Whether a long-term rental that ended early is re-priced at the daily rate:
 * fewer blocks than the minimum, and not waived by the business.
 */
export function isRepricedAtDailyRate(terms: BlockRentTerms, blocksUsed: number | null): boolean {
  return (
    terms.isLongTerm &&
    !terms.isDailyRateWaived &&
    blocksUsed !== null &&
    blocksUsed < terms.longTermMinimumDays
  );
}

/**
 * What a period should cost now. While the car is out, the whole period
 * (charged in advance). Once it is back, only the blocks used, re-priced at
 * the daily rate if the rental ended below the long-term minimum.
 */
export function owedForPeriod(
  terms: BlockRentTerms,
  period: BlockPeriod,
  blocksUsed: number | null,
): number {
  if (blocksUsed === null) {
    return rentForBlocks(terms, period);
  }
  const usedEnd = Math.min(period.endBlock, blocksUsed);
  if (usedEnd <= period.firstBlock) {
    return 0;
  }
  const isAtDailyRate = !terms.isLongTerm || isRepricedAtDailyRate(terms, blocksUsed);
  return rentForBlocks(terms, { firstBlock: period.firstBlock, endBlock: usedEnd }, isAtDailyRate);
}

/** A rent line already on the ledger for one period. */
export interface ChargedRentLine {
  kind: "charge" | "credit";
  periodFirstBlock: number;
  amountCents: number;
  gstCents: number;
  isCorrection: boolean;
  /** The line has been reversed: the business changed this period by hand. */
  isReversed: boolean;
}

/** A rent line the run should add. */
export interface RentLineToAdd {
  kind: "charge" | "credit";
  period: BlockPeriod;
  amountCents: number;
  isCorrection: boolean;
  /**
   * The GST on a correction follows the line it corrects, so it matches the
   * invoice (null for an original: the charge type and registration decide).
   */
  correctionGstCents: number | null;
}

function netChargedCents(lines: readonly ChargedRentLine[]): number {
  return lines.reduce(
    (total, line) => total + (line.kind === "charge" ? line.amountCents : -line.amountCents),
    0,
  );
}

/** The correction for one period that already has its original charge. */
function correctionFor(
  period: BlockPeriod,
  owedCents: number,
  lines: readonly ChargedRentLine[],
): RentLineToAdd | null {
  const original = lines.find((line) => line.kind === "charge" && !line.isCorrection);
  const differenceCents = owedCents - netChargedCents(lines);
  if (!original || differenceCents === 0) {
    return null;
  }
  const amountCents = Math.abs(differenceCents);
  return {
    kind: differenceCents > 0 ? "charge" : "credit",
    period,
    amountCents,
    isCorrection: true,
    correctionGstCents: original.gstCents > 0 ? gstIncludedIn(amountCents) : 0,
  };
}

/**
 * Where one period stands with the rent run: not charged yet, charged (so
 * only a correction can follow), or left as the business changed it by hand
 * (a line of it reversed), which the run never touches.
 */
type PeriodStanding = "not_charged" | "charged" | "left_as_changed";

function linesOfPeriod(
  charged: readonly ChargedRentLine[],
  period: BlockPeriod,
): ChargedRentLine[] {
  return charged.filter((line) => line.periodFirstBlock === period.firstBlock);
}

function periodStanding(lines: readonly ChargedRentLine[]): PeriodStanding {
  if (lines.some((line) => line.isReversed)) {
    return "left_as_changed";
  }
  return lines.some((line) => line.kind === "charge" && !line.isCorrection)
    ? "charged"
    : "not_charged";
}

/** The periods to look at: every period due, and every period anything was charged for. */
function periodsToReconcile(
  terms: BlockRentTerms,
  progress: RentProgress,
  charged: readonly ChargedRentLine[],
): BlockPeriod[] {
  const byFirstBlock = new Map<number, BlockPeriod>();
  for (const period of duePeriods(terms, progress)) {
    byFirstBlock.set(period.firstBlock, period);
  }
  for (const line of charged) {
    if (!byFirstBlock.has(line.periodFirstBlock)) {
      byFirstBlock.set(line.periodFirstBlock, periodOfBlock(terms, line.periodFirstBlock));
    }
  }
  return [...byFirstBlock.values()].sort((first, second) => first.firstBlock - second.firstBlock);
}

/**
 * The rent lines to add so each period has cost exactly what it should:
 * an original charge for a due period not charged yet, and a correction for
 * any difference after a return or re-pricing. A period the business has
 * reversed a line of is left as they made it. Running it on the result adds
 * nothing (rule 20).
 */
export function rentLinesToAdd(
  terms: BlockRentTerms,
  progress: RentProgress,
  charged: readonly ChargedRentLine[],
): RentLineToAdd[] {
  const dueFirstBlocks = new Set(duePeriods(terms, progress).map((period) => period.firstBlock));
  return periodsToReconcile(terms, progress, charged).flatMap((period): RentLineToAdd[] => {
    const lines = linesOfPeriod(charged, period);
    const standing = periodStanding(lines);
    if (standing === "left_as_changed") {
      return [];
    }
    if (standing === "not_charged") {
      return dueFirstBlocks.has(period.firstBlock)
        ? [originalCharge(terms, period, progress.blocksUsed)]
        : [];
    }
    const correction = correctionFor(
      period,
      owedForPeriod(terms, period, progress.blocksUsed),
      lines,
    );
    return correction ? [correction] : [];
  });
}

/** A due period's first charge: what it costs now (the used blocks, if the car is already back). */
function originalCharge(
  terms: BlockRentTerms,
  period: BlockPeriod,
  blocksUsed: number | null,
): RentLineToAdd {
  return {
    kind: "charge",
    period,
    amountCents: owedForPeriod(terms, period, blocksUsed),
    isCorrection: false,
    correctionGstCents: null,
  };
}

/** A rent charge still to come: its period, and what the rent run will charge for it. */
export interface RentToCome {
  period: BlockPeriod;
  amountCents: number;
}

/**
 * The first rent of a booking, charged at the handover: a long-term
 * rental's first week, or a short hire's booked blocks. The same amount the
 * rent run charges for it.
 */
export function firstRentOf(terms: BlockRentTerms): RentToCome {
  const period = periodOfBlock(terms, 0);
  return { period, amountCents: owedForPeriod(terms, period, null) };
}

/**
 * The next rent the run will charge while the car is out: the first period
 * from the handover it has not charged yet (one already due but waiting for
 * tonight's run included), at the amount the run will charge. None once the
 * car is back (only corrections follow), and none for a period starting at
 * or after the booked end while the car is not yet late back: it is only
 * charged if the car is still out then. `plannedEndBlock` is the block the
 * booked end falls in, none when ongoing.
 */
export function nextRentOf(
  terms: BlockRentTerms,
  progress: RentProgress,
  charged: readonly ChargedRentLine[],
  plannedEndBlock: number | null,
): RentToCome | null {
  if (progress.blocksUsed !== null) {
    return null;
  }
  let period = periodOfBlock(terms, 0);
  // Ends: every period charged lies behind, and the charged lines are finite.
  while (periodStanding(linesOfPeriod(charged, period)) !== "not_charged") {
    period = periodOfBlock(terms, period.endBlock);
  }
  const isAfterBookedEnd = plannedEndBlock !== null && period.firstBlock >= plannedEndBlock;
  if (isAfterBookedEnd && progress.currentBlock < plannedEndBlock) {
    return null;
  }
  return { period, amountCents: owedForPeriod(terms, period, null) };
}

/** The week starts a long-term rate change can begin from: after the week now running. */
export function upcomingWeekStarts(currentBlock: number, count: number): number[] {
  const nextWeek = currentBlock - (currentBlock % DAYS_PER_WEEK) + DAYS_PER_WEEK;
  return Array.from({ length: count }, (_, index) => nextWeek + index * DAYS_PER_WEEK);
}

export type BlockRateChangeProblem =
  "not_long_term" | "not_week_start" | "too_soon" | "already_has_rate" | "unchanged";

/**
 * What is wrong with a proposed weekly price, if anything: long-term rentals
 * only, from a week start after the one running, never a week that already
 * has a signed rate, and different from the rate that week would have.
 */
export function blockRateChangeProblem(
  terms: BlockRentTerms,
  change: { fromBlock: number; weeklyRateCents: number },
  currentBlock: number,
): BlockRateChangeProblem | null {
  if (!terms.isLongTerm) {
    return "not_long_term";
  }
  if (change.fromBlock % DAYS_PER_WEEK !== 0) {
    return "not_week_start";
  }
  if (change.fromBlock <= currentBlock) {
    return "too_soon";
  }
  if (terms.rates.some((rate) => rate.fromBlock === change.fromBlock)) {
    return "already_has_rate";
  }
  const inForce = rateForBlock(terms.rates, change.fromBlock);
  return inForce.weeklyRateCents === change.weeklyRateCents ? "unchanged" : null;
}

/** A rate change can be signed only before the week it starts in has begun (no backdating). */
export function isBlockRateChangeSignable(
  handedOverAt: Date,
  fromBlock: number,
  now: Date,
): boolean {
  return now.getTime() < blockStartsAt(handedOverAt, fromBlock).getTime();
}
