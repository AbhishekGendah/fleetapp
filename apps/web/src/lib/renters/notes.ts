import type { AnyDatabase, AnyTransaction } from "@fleetapp/db/client";
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ENTITY_TYPES,
  renterNotes,
  users,
  type ActivityAction,
} from "@fleetapp/db/schema";
import { withTenant } from "@fleetapp/db/tenant-context";
import { and, desc, eq, isNull } from "drizzle-orm";

import { recordUserChange, type ActingUser } from "../acting-user";
import { lockCurrentRenter } from "./renter-records";

/** The note itself is never written into the log, only that one was added or removed. */
function logNote(
  tx: AnyTransaction,
  actor: ActingUser,
  noteId: string,
  action: ActivityAction,
  renterId: string,
): Promise<void> {
  return recordUserChange(tx, actor, {
    entityType: ACTIVITY_ENTITY_TYPES.renterNote,
    entityId: noteId,
    action,
    valuesAfter: { renterId },
  });
}

/** Adds a dated note to a current Renter of the signed-in User's Operator. */
export async function addNote(
  database: AnyDatabase,
  actor: ActingUser,
  renterId: string,
  body: string,
): Promise<"added" | "not_found"> {
  return withTenant(database, actor.operatorId, async (tx) => {
    if (!(await lockCurrentRenter(tx, actor.operatorId, renterId))) {
      return "not_found";
    }
    const [added] = await tx
      .insert(renterNotes)
      .values({ operatorId: actor.operatorId, renterId, body, writtenByUserId: actor.userId })
      .returning({ id: renterNotes.id });
    if (!added) {
      throw new Error("The note was not saved.");
    }
    await logNote(tx, actor, added.id, ACTIVITY_ACTIONS.created, renterId);
    return "added";
  });
}

/** Takes a note written by mistake off the list. It is kept, and stays in the Log (rule 13). */
export async function removeNote(
  database: AnyDatabase,
  actor: ActingUser,
  renterId: string,
  noteId: string,
): Promise<"removed" | "not_found"> {
  return withTenant(database, actor.operatorId, async (tx) => {
    if (!(await lockCurrentRenter(tx, actor.operatorId, renterId))) {
      return "not_found";
    }
    const [removed] = await tx
      .update(renterNotes)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(renterNotes.id, noteId),
          eq(renterNotes.renterId, renterId),
          eq(renterNotes.operatorId, actor.operatorId),
          isNull(renterNotes.archivedAt),
        ),
      )
      .returning({ id: renterNotes.id });
    if (!removed) {
      return "not_found";
    }
    await logNote(tx, actor, removed.id, ACTIVITY_ACTIONS.archived, renterId);
    return "removed";
  });
}

export interface RenterNote {
  id: string;
  body: string;
  writtenBy: string;
  writtenAt: Date;
  removedAt: Date | null;
}

/** A Renter's notes, newest first: those in use, or every one ever written (for the download). */
export async function listNotes(
  database: AnyDatabase,
  operatorId: string,
  renterId: string,
  { isRemovedIncluded = false }: { isRemovedIncluded?: boolean } = {},
): Promise<RenterNote[]> {
  return withTenant(database, operatorId, (tx) =>
    tx
      .select({
        id: renterNotes.id,
        body: renterNotes.body,
        writtenBy: users.fullName,
        writtenAt: renterNotes.createdAt,
        removedAt: renterNotes.archivedAt,
      })
      .from(renterNotes)
      .innerJoin(users, eq(users.id, renterNotes.writtenByUserId))
      .where(
        and(
          eq(renterNotes.operatorId, operatorId),
          eq(renterNotes.renterId, renterId),
          isRemovedIncluded ? undefined : isNull(renterNotes.archivedAt),
        ),
      )
      .orderBy(desc(renterNotes.createdAt)),
  );
}

/** Every note ever written about the Renter, for their Log. */
export async function listNoteIds(
  database: AnyDatabase,
  operatorId: string,
  renterId: string,
): Promise<string[]> {
  const notes = await listNotes(database, operatorId, renterId, { isRemovedIncluded: true });
  return notes.map((note) => note.id);
}
