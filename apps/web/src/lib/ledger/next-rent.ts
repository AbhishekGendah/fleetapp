import { blocksBetween, blockStartsAt, firstRentOf, nextRentOf } from "@fleetapp/core";
import type { AnyDatabase } from "@fleetapp/db/client";
import { withTenant } from "@fleetapp/db/tenant-context";

import { loadBlockRates } from "../rentals/block-rates";
import {
  blockTermsOf,
  loadChargedRentLines,
  readBlockRental,
  rentProgressOf,
} from "./block-rent-terms";

/** The next rent charge, as the rent run will make it. */
export interface NextRent {
  /** When it is charged: the start of its period, or the handover for a booking's first rent. */
  chargedAt: Date;
  amountCents: number;
  /** A booking's first rent, charged at the handover. */
  isFirst: boolean;
}

/**
 * When and how much the next rent charge is, worked out by the rent run's
 * own rule (packages/core rent-blocks): a booking's first rent, or the next
 * period of a rental that is out. None for anything else (a draft, back,
 * finished, a fixed rental with every week charged, or a rental from before
 * rent in blocks, which the run no longer charges). Read only.
 */
export async function loadNextRent(
  database: AnyDatabase,
  operatorId: string,
  rentalId: string,
  now: Date,
): Promise<NextRent | null> {
  return withTenant(database, operatorId, async (tx) => {
    const rental = await readBlockRental(tx, operatorId, rentalId, false);
    if (!rental) {
      return null;
    }
    const terms = blockTermsOf(rental, await loadBlockRates(tx, operatorId, rental.id));
    if (rental.status === "booked") {
      const first = firstRentOf(terms);
      return { chargedAt: rental.plannedStart, amountCents: first.amountCents, isFirst: true };
    }
    const { handedOverAt } = rental;
    if (rental.status !== "active" || !handedOverAt) {
      return null;
    }
    const handedOver = { ...rental, handedOverAt };
    const charged = await loadChargedRentLines(tx, operatorId, handedOver);
    const plannedEndBlock = rental.plannedEnd
      ? blocksBetween(handedOverAt, rental.plannedEnd, rental.graceMinutes)
      : null;
    const next = nextRentOf(terms, rentProgressOf(handedOver, now), charged, plannedEndBlock);
    return next
      ? {
          chargedAt: blockStartsAt(handedOverAt, next.period.firstBlock),
          amountCents: next.amountCents,
          isFirst: false,
        }
      : null;
  });
}
