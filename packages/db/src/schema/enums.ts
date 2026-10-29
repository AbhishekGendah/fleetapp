import { AUSTRALIAN_STATE_CODES } from "@fleetapp/core";
import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Australian states and territories. The product is Australia only, so this is
 * a closed set rather than free text. The list itself lives in packages/core,
 * beside the postcode rules that use it.
 */
export const australianStateEnum = pgEnum("australian_state", AUSTRALIAN_STATE_CODES);

/**
 * The Operator's standing with AGS. `read_only` is the state after a failed
 * AGS subscription payment: view and export only. See docs/design/01.
 */
export const SUBSCRIPTION_STATUSES = [
  "trial",
  "active",
  "past_due",
  "read_only",
  "cancelled",
] as const;
export const subscriptionStatusEnum = pgEnum("subscription_status", SUBSCRIPTION_STATUSES);

/** Who performed a logged action. See rule 19 in CLAUDE.md. */
export const ACTOR_TYPES = ["user", "admin", "system", "renter_link"] as const;
export const actorTypeEnum = pgEnum("actor_type", ACTOR_TYPES);

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export type ActorType = (typeof ACTOR_TYPES)[number];
