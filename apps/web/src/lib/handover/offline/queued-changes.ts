/** A damage mark made on the phone: its own key until the server gives it an id. */
export interface QueuedMark {
  kind: "mark";
  inspectionId: string;
  markKey: string;
  x: number;
  y: number;
  description: string;
}

/** Which photo: one on the list, a damage mark already saved, or one made on the phone. */
export type QueuedPhotoTarget =
  { photoName: string } | { damageMarkId: string } | { markKey: string };

export interface QueuedPhoto {
  kind: "photo";
  inspectionId: string;
  target: QueuedPhotoTarget;
  /** Already shrunk on the phone (rule 21). */
  photo: Blob;
  thumbnail: Blob;
}

/** A change about to be queued: the queue adds its number and time. */
export type NewQueuedChange = QueuedMark | QueuedPhoto;

export type QueuedChange = NewQueuedChange & { id?: number; queuedAt: number };

/** What sending needs from the server, as the handover page's actions provide it. */
export interface QueueSenders {
  addMark: (mark: QueuedMark) => Promise<{ markId: string } | { problem: string }>;
  sendPhoto: (
    inspectionId: string,
    target: { photoName: string } | { damageMarkId: string },
    files: { photo: Blob; thumbnail: Blob },
  ) => Promise<string | null>;
}

/** Where the queue is kept: the phone's own database, or a stand-in in tests. */
export interface QueueStore {
  /** Oldest first: marks before the photos taken of them. */
  pending(inspectionId: string): Promise<QueuedChange[]>;
  remove(id: number): Promise<void>;
  markIdFor(markKey: string): Promise<string | null>;
  rememberMark(markKey: string, markId: string): Promise<void>;
}

export type QueueRunResult =
  | { status: "sent"; count: number }
  /** Stopped at the first that did not go: it and the rest stay queued for next time. */
  | { status: "stopped"; count: number; problem: string };

const WAITING_FOR_MARK = "Waiting for its damage mark to be saved first.";

async function photoTarget(
  store: QueueStore,
  target: QueuedPhotoTarget,
): Promise<{ photoName: string } | { damageMarkId: string } | null> {
  if (!("markKey" in target)) {
    return target;
  }
  const markId = await store.markIdFor(target.markKey);
  return markId ? { damageMarkId: markId } : null;
}

async function sendOne(
  store: QueueStore,
  senders: QueueSenders,
  change: QueuedChange,
): Promise<string | null> {
  if (change.kind === "mark") {
    const added = await senders.addMark(change);
    if ("problem" in added) {
      return added.problem;
    }
    await store.rememberMark(change.markKey, added.markId);
    return null;
  }
  const target = await photoTarget(store, change.target);
  if (!target) {
    return WAITING_FOR_MARK;
  }
  return senders.sendPhoto(change.inspectionId, target, change);
}

/**
 * Sends what was queued on the phone, one at a time in the order it was
 * made, so a mark is saved before its photo. Each is removed only once the
 * server has it; the first that fails stops the run and waits for signal.
 */
export async function runQueue(
  store: QueueStore,
  senders: QueueSenders,
  inspectionId: string,
): Promise<QueueRunResult> {
  let count = 0;
  for (const change of await store.pending(inspectionId)) {
    const problem = await sendOne(store, senders, change);
    if (problem) {
      return { status: "stopped", count, problem };
    }
    await store.remove(change.id!);
    count += 1;
  }
  return { status: "sent", count };
}
