import { describe, expect, it } from "vitest";

import {
  PHOTO_TARGET_GONE,
  runQueue,
  type QueuedChange,
  type QueuedPhotoTarget,
  type QueueSenders,
  type QueueStore,
} from "../src/lib/handover/offline/queued-changes";

const INSPECTION = "inspection-1";
const BLOB = new Blob(["x"], { type: "image/jpeg" });

function memoryStore(changes: QueuedChange[]): QueueStore & { left: () => QueuedChange[] } {
  let queue = [...changes];
  const marks = new Map<string, string>();
  return {
    pending: async () => [...queue],
    remove: async (id) => {
      queue = queue.filter((change) => change.id !== id);
    },
    markIdFor: async (markKey) => marks.get(markKey) ?? null,
    rememberMark: async (markKey, markId) => {
      marks.set(markKey, markId);
    },
    left: () => queue,
  };
}

const mark = (id: number): QueuedChange => ({
  id,
  kind: "mark",
  inspectionId: INSPECTION,
  markKey: "local-1",
  x: 1,
  y: 2,
  description: "Dent",
  queuedAt: id,
});
const photo = (id: number, target: QueuedPhotoTarget): QueuedChange => ({
  id,
  kind: "photo",
  inspectionId: INSPECTION,
  target,
  photo: BLOB,
  thumbnail: BLOB,
  queuedAt: id,
});

describe("the phone's handover queue", () => {
  it("saves a mark before the photo of it, sending that photo to the mark's new id", async () => {
    const sentTo: unknown[] = [];
    const senders: QueueSenders = {
      addMark: async () => ({ markId: "server-mark" }),
      sendPhoto: async (_inspection, target) => {
        sentTo.push(target);
        return null;
      },
    };
    const store = memoryStore([
      mark(1),
      photo(2, { markKey: "local-1" }),
      photo(3, { photoName: "Front" }),
    ]);

    const result = await runQueue(store, senders, INSPECTION);

    expect(result).toEqual({ status: "sent", count: 3 });
    expect(sentTo).toEqual([{ damageMarkId: "server-mark" }, { photoName: "Front" }]);
    expect(store.left()).toEqual([]);
  });

  it("stops at the first that fails, keeping it and the rest for next time", async () => {
    const senders: QueueSenders = {
      addMark: async () => ({ markId: "m" }),
      sendPhoto: async (_inspection, target) =>
        "photoName" in target && target.photoName === "Rear" ? "No signal" : null,
    };
    const store = memoryStore([
      photo(1, { photoName: "Front" }),
      photo(2, { photoName: "Rear" }),
      photo(3, { photoName: "Boot" }),
    ]);

    const result = await runQueue(store, senders, INSPECTION);

    expect(result).toEqual({ status: "stopped", count: 1, problem: "No signal" });
    expect(store.left().map((change) => change.id)).toEqual([2, 3]);
  });

  it("drops a photo whose damage mark is gone, rather than holding up the rest (batch 5 review)", async () => {
    const senders: QueueSenders = {
      addMark: async () => ({ markId: "m" }),
      sendPhoto: async (_inspection, target) =>
        "damageMarkId" in target ? PHOTO_TARGET_GONE : null,
    };
    const store = memoryStore([
      photo(1, { damageMarkId: "removed-mark" }),
      photo(2, { photoName: "Boot" }),
    ]);

    const result = await runQueue(store, senders, INSPECTION);

    expect(result).toEqual({ status: "sent", count: 2 });
    expect(store.left()).toEqual([]);
  });
});
