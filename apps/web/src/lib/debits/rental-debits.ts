import {
  operatorSettingsSchema,
  readSettings,
  type DebitCollectionPlan,
  type RentalStatus,
} from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import { debitItems, debitPlans, rentals } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, sql } from "drizzle-orm";

import { collectionChoicesFor, isStripeReadyFor } from "./debit-plans";
import { loadRentalDebits, type RentalDebitRow } from "./debit-queries";

/** A one-off charge's plan, as the rental's Money card shows and changes it. */
export interface ChargePlanRow {
  ledgerLineId: string;
  plan: DebitCollectionPlan;
  weeks: number | null;
  /** Parts already in a debit: none means it can still be changed. */
  partsDebited: number;
}

/** What the rental's page shows about its debits (docs/plans/phase-4-slice-5.md, Screens). */
export interface RentalDebitState {
  debits: RentalDebitRow[];
  /** The ways a new one-off charge can be collected; none without a working direct debit. */
  choices: DebitCollectionPlan[];
  /** The rental's default for a one-off charge, from its settings copy (rule 14). */
  defaultCollection: DebitCollectionPlan;
  isPaused: boolean;
  plans: ChargePlanRow[];
  pending: { cents: number; since: Date } | null;
  lastCleared: RentalDebitRow | null;
}

export async function loadRentalDebitState(
  database: AnyDatabase,
  operatorId: string,
  rental: {
    id: string;
    renterId: string;
    status: RentalStatus;
    settingsSnapshot: Record<string, unknown>;
  },
): Promise<RentalDebitState> {
  const isStripeReady = await isStripeReadyFor(database, operatorId);
  const [debits, inTenant] = await Promise.all([
    loadRentalDebits(database, operatorId, rental.id),
    withTenant(database, operatorId, async (tx) => ({
      choices: await collectionChoicesFor(tx, operatorId, rental, isStripeReady),
      paused: await tx
        .select({ at: rentals.debitsPausedAt })
        .from(rentals)
        .where(and(eq(rentals.id, rental.id), eq(rentals.operatorId, operatorId))),
      plans: await tx
        .select({
          ledgerLineId: debitPlans.ledgerLineId,
          plan: debitPlans.plan,
          weeks: debitPlans.weeks,
          partsDebited: sql<number>`(select count(*) from ${debitItems}
            where ${debitItems.ledgerLineId} = ${debitPlans.ledgerLineId})`.mapWith(Number),
        })
        .from(debitPlans)
        .where(and(eq(debitPlans.operatorId, operatorId), eq(debitPlans.rentalId, rental.id))),
    })),
  ]);
  const pendingDebits = debits.filter((debit) => debit.status === "pending");
  const oldestPending = pendingDebits.at(-1);
  return {
    debits,
    choices: inTenant.choices,
    defaultCollection: readSettings(operatorSettingsSchema, rental.settingsSnapshot)
      .oneOffChargeCollection,
    isPaused: Boolean(inTenant.paused[0]?.at),
    plans: inTenant.plans,
    pending: oldestPending
      ? {
          cents: pendingDebits.reduce((total, debit) => total + debit.amountCents, 0),
          since: oldestPending.requestedAt,
        }
      : null,
    lastCleared:
      debits.find((debit) => debit.status === "succeeded" || debit.status === "refunded") ?? null,
  };
}

/** The ways a new one-off charge on this rental can be collected, and its default (from a damage record). */
export async function loadCollectionChoices(
  database: AnyDatabase,
  operatorId: string,
  rentalId: string,
): Promise<Pick<RentalDebitState, "choices" | "defaultCollection">> {
  const isStripeReady = await isStripeReadyFor(database, operatorId);
  return withTenant(database, operatorId, async (tx) => {
    const [rental] = await tx
      .select({
        renterId: rentals.renterId,
        status: rentals.status,
        settingsSnapshot: rentals.settingsSnapshot,
      })
      .from(rentals)
      .where(and(eq(rentals.id, rentalId), eq(rentals.operatorId, operatorId)));
    const defaultCollection = readSettings(
      operatorSettingsSchema,
      rental?.settingsSnapshot ?? {},
    ).oneOffChargeCollection;
    return {
      choices: rental ? await collectionChoicesFor(tx, operatorId, rental, isStripeReady) : [],
      defaultCollection,
    };
  });
}
