import {
  DEFAULT_NUMBERING,
  documentNumberText,
  NUMBERING_SERIES,
  type Numbering,
  type NumberingSeries,
} from "@fleetapp/core";
import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import { ACTIVITY_ACTIONS, ACTIVITY_ENTITY_TYPES, documentNumbering } from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, eq, sql } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import type { NumberingInput } from "./numbering-input";

export interface TakenNumber {
  number: number;
  /** As printed, e.g. "INV-1001". */
  numberText: string;
}

/** The business's numbering for a series, made with the defaults the first time (rule 27). */
async function ensureNumbering(
  tx: AnyTransaction,
  operatorId: string,
  series: NumberingSeries,
): Promise<void> {
  await tx
    .insert(documentNumbering)
    .values({ operatorId, series, ...DEFAULT_NUMBERING[series] })
    .onConflictDoNothing();
}

const ofSeries = (operatorId: string, series: NumberingSeries) =>
  and(eq(documentNumbering.operatorId, operatorId), eq(documentNumbering.series, series));

/**
 * Takes the next number and moves it on, inside the transaction that
 * issues the document (rule 17): the row stays locked until it commits, so
 * two issued at once take the next two numbers, and a failure takes none.
 */
export async function takeDocumentNumber(
  tx: AnyTransaction,
  operatorId: string,
  series: NumberingSeries,
): Promise<TakenNumber> {
  await ensureNumbering(tx, operatorId, series);
  const [taken] = await tx
    .update(documentNumbering)
    .set({
      nextNumber: sql`${documentNumbering.nextNumber} + 1`,
      isStarted: true,
      updatedAt: new Date(),
    })
    .where(ofSeries(operatorId, series))
    .returning({ prefix: documentNumbering.prefix, next: documentNumbering.nextNumber });
  if (!taken) {
    throw new Error("The business's numbering could not be found.");
  }
  const number = taken.next - 1;
  return { number, numberText: documentNumberText({ prefix: taken.prefix, nextNumber: number }) };
}

export interface NumberingView extends Numbering {
  series: NumberingSeries;
  /** A document has been issued: the next number can no longer be set. */
  isStarted: boolean;
}

/** Each series' prefix and next number, for Settings. */
export async function loadNumbering(
  database: AnyDatabase,
  operatorId: string,
): Promise<NumberingView[]> {
  const stored = await withTenant(database, operatorId, (tx) =>
    tx
      .select({
        series: documentNumbering.series,
        prefix: documentNumbering.prefix,
        nextNumber: documentNumbering.nextNumber,
        isStarted: documentNumbering.isStarted,
      })
      .from(documentNumbering)
      .where(eq(documentNumbering.operatorId, operatorId)),
  );
  return NUMBERING_SERIES.map(
    (series) =>
      stored.find((row) => row.series === series) ?? {
        series,
        ...DEFAULT_NUMBERING[series],
        isStarted: false,
      },
  );
}

export type SaveNumberingResult = "saved" | "started";

/**
 * Saves a series' prefix and, until its first document, its next number.
 * Once started, a different next number is refused: it would leave a gap or
 * repeat one (rule 17). The prefix may change at any time; documents
 * already issued keep the number they were printed with.
 */
export async function saveNumbering(
  database: AnyDatabase,
  actor: ActingUser,
  series: NumberingSeries,
  input: NumberingInput,
): Promise<SaveNumberingResult> {
  return withTenant(database, actor.operatorId, async (tx) => {
    await ensureNumbering(tx, actor.operatorId, series);
    const [before] = await tx
      .select({
        prefix: documentNumbering.prefix,
        nextNumber: documentNumbering.nextNumber,
        isStarted: documentNumbering.isStarted,
      })
      .from(documentNumbering)
      .where(ofSeries(actor.operatorId, series))
      .for("update");
    if (!before) {
      throw new Error("The business's numbering could not be found.");
    }
    if (before.isStarted && input.nextNumber !== before.nextNumber) {
      return "started";
    }
    await tx
      .update(documentNumbering)
      .set({ prefix: input.prefix, nextNumber: input.nextNumber, updatedAt: new Date() })
      .where(ofSeries(actor.operatorId, series));
    await recordUserChange(tx, actor, {
      entityType: ACTIVITY_ENTITY_TYPES.documentNumbering,
      entityId: actor.operatorId,
      action: ACTIVITY_ACTIONS.updated,
      valuesBefore: { series, prefix: before.prefix, nextNumber: before.nextNumber },
      valuesAfter: { series, prefix: input.prefix, nextNumber: input.nextNumber },
    });
    return "saved";
  });
}
