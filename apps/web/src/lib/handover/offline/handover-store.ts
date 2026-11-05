import { MILLISECONDS_PER_DAY } from "@fleetapp/core";
import Dexie, { type Table } from "dexie";

import { HANDOVER_DATABASE_NAME, KEPT_ON_PHONE_DAYS } from "./phone-limits";
import type { NewQueuedChange, QueuedChange, QueueStore } from "./queued-changes";

/** What has been typed on the checklist, kept as typed so a lost page loses nothing. */
export interface HandoverDraft {
  inspectionId: string;
  values: Record<string, string>;
  savedAt: number;
}

interface SavedMark {
  markKey: string;
  markId: string;
  inspectionId: string;
  savedAt: number;
}

/**
 * The handover checklist's own database on the phone (Dexie, over the
 * browser's IndexedDB): what has been typed, the photos and damage marks
 * waiting to send, and which marks the server has. Nothing else is kept,
 * and all of it is wiped once the handover is finished or after a week.
 */
class HandoverDatabase extends Dexie {
  drafts!: Table<HandoverDraft, string>;
  queue!: Table<QueuedChange, number>;
  marks!: Table<SavedMark, string>;

  constructor() {
    super(HANDOVER_DATABASE_NAME);
    this.version(1).stores({
      drafts: "inspectionId, savedAt",
      queue: "++id, inspectionId, queuedAt",
      marks: "markKey, inspectionId, savedAt",
    });
  }
}

let database: HandoverDatabase | null = null;

function handoverDatabase(): HandoverDatabase {
  database ??= new HandoverDatabase();
  return database;
}

export function saveDraft(inspectionId: string, values: Record<string, string>): Promise<string> {
  return handoverDatabase().drafts.put({ inspectionId, values, savedAt: Date.now() });
}

export async function loadDraft(inspectionId: string): Promise<HandoverDraft | null> {
  return (await handoverDatabase().drafts.get(inspectionId)) ?? null;
}

export function queueChange(change: NewQueuedChange): Promise<number> {
  return handoverDatabase().queue.add({ ...change, queuedAt: Date.now() } as QueuedChange);
}

/** The queue kept on the phone, as the sender works through it. */
export const phoneQueueStore: QueueStore = {
  pending: (inspectionId) =>
    handoverDatabase().queue.where("inspectionId").equals(inspectionId).sortBy("queuedAt"),
  remove: (id) => handoverDatabase().queue.delete(id),
  markIdFor: async (markKey) => (await handoverDatabase().marks.get(markKey))?.markId ?? null,
  rememberMark: async (markKey, markId) => {
    const queued = await handoverDatabase()
      .queue.filter((change) => change.kind === "mark" && change.markKey === markKey)
      .first();
    await handoverDatabase().marks.put({
      markKey,
      markId,
      inspectionId: queued?.inspectionId ?? "",
      savedAt: Date.now(),
    });
  },
};

export function countQueued(inspectionId: string): Promise<number> {
  return handoverDatabase().queue.where("inspectionId").equals(inspectionId).count();
}

/** Wipes these checklists from the phone: their typing, their queues and their marks. */
export async function forgetHandovers(inspectionIds: readonly string[]): Promise<void> {
  if (inspectionIds.length === 0) {
    return;
  }
  const db = handoverDatabase();
  await db.transaction("rw", db.drafts, db.queue, db.marks, async () => {
    await db.drafts.where("inspectionId").anyOf(inspectionIds).delete();
    await db.queue.where("inspectionId").anyOf(inspectionIds).delete();
    await db.marks.where("inspectionId").anyOf(inspectionIds).delete();
  });
}

/** Wipes anything older than a week, so a shared or lost phone does not keep a Renter's details. */
export async function forgetOldHandovers(now: number = Date.now()): Promise<void> {
  const cutoff = now - KEPT_ON_PHONE_DAYS * MILLISECONDS_PER_DAY;
  const db = handoverDatabase();
  await db.transaction("rw", db.drafts, db.queue, db.marks, async () => {
    await db.drafts.where("savedAt").below(cutoff).delete();
    await db.queue.where("queuedAt").below(cutoff).delete();
    await db.marks.where("savedAt").below(cutoff).delete();
  });
}

/** Photos and damage marks on this phone not yet sent, across every checklist. */
export function countAllQueued(): Promise<number> {
  return handoverDatabase().queue.count();
}

/** Wipes every checklist from the phone, as at sign-out. */
export async function forgetAllHandovers(): Promise<void> {
  database?.close();
  database = null;
  await Dexie.delete(HANDOVER_DATABASE_NAME);
}
