"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { orSendFailed } from "../../../../lib/files/or-send-failed";
import { SEND_FAILED_MESSAGE, sendToStorage } from "../../../../lib/files/send-to-storage";
import {
  forgetOldHandovers,
  phoneQueueStore,
  queueChange,
} from "../../../../lib/handover/offline/handover-store";
import {
  runQueue,
  type MarkSentFromPhone,
  type NewQueuedChange,
  type QueuedChange,
  type QueueSenders,
  type QueueStore,
} from "../../../../lib/handover/offline/queued-changes";
import {
  addDamageMarkAction,
  finishChecklistPhotoAction,
  startChecklistPhotoAction,
} from "./actions";

/** How long to wait before trying the queue again after it stopped. */
const RETRY_MS = 15_000;

export type QueueState =
  { status: "idle" } | { status: "sending" } | { status: "waiting"; problem: string };

const senders: QueueSenders = {
  addMark: (mark) =>
    addDamageMarkAction(mark.inspectionId, { x: mark.x, y: mark.y, description: mark.description }),
  sendPhoto: async (inspectionId, target, files) => {
    const start = await startChecklistPhotoAction(inspectionId, target, {
      photo: { contentType: files.photo.type, sizeBytes: files.photo.size },
      thumbnail: { contentType: files.thumbnail.type, sizeBytes: files.thumbnail.size },
    });
    if (start.status === "refused") {
      return start.message;
    }
    const [isPhotoSent] = await Promise.all([
      sendToStorage(start.photo.permission, files.photo),
      sendToStorage(start.thumbnail.permission, files.thumbnail),
    ]);
    if (!isPhotoSent) {
      return SEND_FAILED_MESSAGE;
    }
    return finishChecklistPhotoAction(start.photo.fileId, start.thumbnail.fileId);
  },
};

/**
 * A photo queued for a mark made on the phone points at the mark's own key;
 * once that mark is saved, it shows against the saved mark (its id), so the
 * mark reads "Waiting to send" rather than "Not taken" until the photo goes.
 */
async function withSavedMarks(pending: QueuedChange[]): Promise<QueuedChange[]> {
  return Promise.all(
    pending.map(async (change) => {
      if (change.kind !== "photo" || !("markKey" in change.target)) {
        return change;
      }
      const markId = await phoneQueueStore.markIdFor(change.target.markKey);
      return markId ? { ...change, target: { damageMarkId: markId } } : change;
    }),
  );
}

/**
 * The handover's queue on this phone (rule 25): photos and damage marks are
 * kept here first, then sent one at a time whenever there is signal (on
 * opening, when the phone comes back online, after each new one, and every
 * so often while something waits). The page refreshes as each batch lands.
 */
export function useHandoverQueue(inspectionId: string): {
  queued: QueuedChange[];
  /** Marks this phone sent while the page has been open, kept until the page shows them saved. */
  sentFromPhone: MarkSentFromPhone[];
  state: QueueState;
  enqueue: (change: NewQueuedChange) => Promise<void>;
  sendNow: () => void;
} {
  const router = useRouter();
  const [queued, setQueued] = useState<QueuedChange[]>([]);
  const [state, setState] = useState<QueueState>({ status: "idle" });
  const [sentFromPhone, setSentFromPhone] = useState<MarkSentFromPhone[]>([]);
  const store = useMarkRemembering(setSentFromPhone);
  const isRunning = useRef(false);
  /** Something was queued while a run was sending: run again straight after, not at the next retry. */
  const isRunAgainWanted = useRef(false);

  const reload = useCallback(async () => {
    setQueued(await withSavedMarks(await phoneQueueStore.pending(inspectionId)));
  }, [inspectionId]);

  const sendNow = useCallback(() => {
    if (!navigator.onLine) {
      return;
    }
    if (isRunning.current) {
      isRunAgainWanted.current = true;
      return;
    }
    isRunning.current = true;
    setState({ status: "sending" });
    void (async () => {
      let problem: string | null = null;
      do {
        isRunAgainWanted.current = false;
        problem = await orSendFailed(async () => {
          const result = await runQueue(store, senders, inspectionId);
          if (result.count > 0) {
            router.refresh();
          }
          return result.status === "stopped" ? result.problem : null;
        });
      } while (isRunAgainWanted.current && !problem);
      isRunning.current = false;
      setState(problem ? { status: "waiting", problem } : { status: "idle" });
      await reload();
    })();
  }, [inspectionId, reload, router, store]);

  const enqueue = useCallback(
    async (change: NewQueuedChange) => {
      await queueChange(change);
      await reload();
      sendNow();
    },
    [reload, sendNow],
  );

  useEffect(() => {
    void forgetOldHandovers().then(reload).then(sendNow);
    window.addEventListener("online", sendNow);
    const retry = window.setInterval(sendNow, RETRY_MS);
    return () => {
      window.removeEventListener("online", sendNow);
      window.clearInterval(retry);
    };
  }, [reload, sendNow]);

  return { queued, sentFromPhone, state, enqueue, sendNow };
}

/**
 * The phone's queue, also noting each mark as the server saves it, with the
 * details it was queued with: the page shows it in place until its own list
 * has the saved mark (see damage-items.ts).
 */
function useMarkRemembering(
  setSentFromPhone: (update: (previous: MarkSentFromPhone[]) => MarkSentFromPhone[]) => void,
): QueueStore {
  const lastPending = useRef<QueuedChange[]>([]);
  return useMemo(
    () => ({
      ...phoneQueueStore,
      pending: async (inspectionId) => {
        const pending = await phoneQueueStore.pending(inspectionId);
        lastPending.current = pending;
        return pending;
      },
      rememberMark: async (markKey, markId) => {
        await phoneQueueStore.rememberMark(markKey, markId);
        const mark = lastPending.current.find(
          (change) => change.kind === "mark" && change.markKey === markKey,
        );
        if (mark?.kind === "mark") {
          const sent = { markKey, markId, x: mark.x, y: mark.y, description: mark.description };
          setSentFromPhone((previous) => [
            ...previous.filter((each) => each.markKey !== markKey),
            sent,
          ]);
        }
      },
    }),
    [setSentFromPhone],
  );
}
