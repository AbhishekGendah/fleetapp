import { OVERRIDABLE_HANDOVER_PROBLEMS, type BookingProblem } from "@fleetapp/core";

/** A handover problem the Operator can let the car go with, given a reason. */
export type OverridableProblemCode =
  "bond_short" | "direct_debit_missing" | "no_insurance" | "no_rego";

/** Each overridable problem's reason, as the form sends it and the checklist keeps it. */
export const OVERRIDE_REASON_FIELDS = {
  bond_short: "bondOverrideReason",
  direct_debit_missing: "directDebitOverrideReason",
  no_insurance: "insuranceOverrideReason",
  no_rego: "regoOverrideReason",
} as const satisfies Record<OverridableProblemCode, string>;

export type OverrideReasonField =
  (typeof OVERRIDE_REASON_FIELDS)[keyof typeof OVERRIDE_REASON_FIELDS];

/** Every reason, empty or not: null where none was typed or none is needed. */
export type OverrideReasons = Record<OverrideReasonField, string | null>;

export const NO_OVERRIDE_REASONS: OverrideReasons = {
  bondOverrideReason: null,
  directDebitOverrideReason: null,
  insuranceOverrideReason: null,
  regoOverrideReason: null,
};

/** Which flag the Log keeps for each reason given: never the reason itself. */
export const OVERRIDE_LOG_FLAGS: Readonly<Record<OverrideReasonField, string>> = {
  bondOverrideReason: "bondOverridden",
  directDebitOverrideReason: "directDebitOverridden",
  insuranceOverrideReason: "insuranceOverridden",
  regoOverrideReason: "regoOverridden",
};

export function isOverridableProblem(
  problem: BookingProblem,
): problem is Extract<BookingProblem, { code: OverridableProblemCode }> {
  return OVERRIDABLE_HANDOVER_PROBLEMS.has(problem.code);
}

/** The first overridable problem found with no reason typed for it, if any. */
export function firstReasonMissing(
  problems: readonly BookingProblem[],
  reasons: OverrideReasons,
): Extract<BookingProblem, { code: OverridableProblemCode }> | null {
  return (
    problems
      .filter(isOverridableProblem)
      .find((problem) => !reasons[OVERRIDE_REASON_FIELDS[problem.code]]) ?? null
  );
}

/**
 * Only the reasons for problems still there: one typed for something since
 * put right (say, the Renter just set up their direct debit) is not kept, and
 * the Log doesn't say it was overridden (review KS-8).
 */
export function reasonsStillNeeded(
  problems: readonly BookingProblem[],
  reasons: OverrideReasons,
): OverrideReasons {
  const needed = new Set(
    problems.filter(isOverridableProblem).map((problem) => OVERRIDE_REASON_FIELDS[problem.code]),
  );
  return Object.fromEntries(
    Object.entries(reasons).map(([field, reason]) => [
      field,
      needed.has(field as OverrideReasonField) ? reason : null,
    ]),
  ) as OverrideReasons;
}

/** The Log's flags for the reasons kept: which checks the car went without. */
export function overrideLogFlags(reasons: OverrideReasons): Record<string, true> {
  return Object.fromEntries(
    Object.entries(reasons)
      .filter(([, reason]) => reason !== null)
      .map(([field]) => [OVERRIDE_LOG_FLAGS[field as OverrideReasonField], true]),
  );
}
