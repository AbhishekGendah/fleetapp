import {
  DEBIT_COLLECTION_PLANS,
  MAXIMUM_SPLIT_WEEKS,
  MINIMUM_SPLIT_WEEKS,
  REQUIRED_MESSAGE,
  type DebitCollectionPlan,
} from "@fleetapp/core";
import { z } from "zod";

import { chargeInputSchema } from "../ledger/ledger-input";

const SPLIT_WEEKS_MESSAGE = `Enter ${MINIMUM_SPLIT_WEEKS} to ${MAXIMUM_SPLIT_WEEKS} weeks.`;

/** How a one-off charge is collected: the plan, and for a split its weeks. */
export interface DebitCollection {
  plan: DebitCollectionPlan;
  weeks: number | null;
}

export const COLLECTION_FIELDS = ["collection", "splitWeeks"] as const;
export type CollectionField = (typeof COLLECTION_FIELDS)[number];

const collectionShape = {
  /** Empty when the choice isn't offered (no direct debit, or Stripe not taking payments). */
  collection: z.union([z.literal(""), z.enum(DEBIT_COLLECTION_PLANS, REQUIRED_MESSAGE)]),
  splitWeeks: z.string().trim(),
};

/** A split's weeks, checked as typed and again on the server (rule 31): 2 to 12, digits only. */
function checkSplitWeeks(
  value: { collection: string; splitWeeks: string },
  context: z.RefinementCtx,
): void {
  if (value.collection !== "split") {
    return;
  }
  const weeks = Number(value.splitWeeks);
  const isValid =
    /^\d+$/.test(value.splitWeeks) && weeks >= MINIMUM_SPLIT_WEEKS && weeks <= MAXIMUM_SPLIT_WEEKS;
  if (!isValid) {
    context.addIssue({ code: "custom", path: ["splitWeeks"], message: SPLIT_WEEKS_MESSAGE });
  }
}

/** Changing how a charge is collected. */
export const collectionInputSchema = z.object(collectionShape).superRefine(checkSplitWeeks);

/** A one-off charge with how it is collected, checked the same way in the form and on the server. */
export const chargeWithCollectionSchema = z
  .object({ ...chargeInputSchema.shape, ...collectionShape })
  .superRefine(checkSplitWeeks);

/** The collection chosen, or null when none was offered. */
export function collectionOf(value: {
  collection: string;
  splitWeeks: string;
}): DebitCollection | null {
  const parsed = z.enum(DEBIT_COLLECTION_PLANS).safeParse(value.collection);
  if (!parsed.success) {
    return null;
  }
  return { plan: parsed.data, weeks: parsed.data === "split" ? Number(value.splitWeeks) : null };
}
