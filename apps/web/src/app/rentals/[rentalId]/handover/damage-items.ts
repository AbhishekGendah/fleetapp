import type {
  MarkSentFromPhone,
  QueuedChange,
  QueuedPhotoTarget,
} from "../../../../lib/handover/offline/queued-changes";
import type { SavedMark } from "./checklist-data";
import type { DamageMarkItem } from "./checklist-damage";
import type { PhotoState } from "./checklist-photos";

export function isWaitingFor(
  queued: readonly QueuedChange[],
  matches: (target: QueuedPhotoTarget) => boolean,
): boolean {
  return queued.some((change) => change.kind === "photo" && matches(change.target));
}

function photoStateOf(
  queued: readonly QueuedChange[],
  saved: SavedMark["photo"],
  matches: (target: QueuedPhotoTarget) => boolean,
): PhotoState {
  if (saved) {
    return { kind: "saved", photo: saved };
  }
  return isWaitingFor(queued, matches) ? { kind: "waiting" } : { kind: "missing" };
}

/**
 * Damage marks to show: the server's, then those still on the phone, each
 * with where its photo is.
 *
 * A mark made on this phone keeps its phone key as its row's key from the
 * moment it is made until long after it is saved, including the moment
 * between leaving the phone's queue and appearing in the page's saved list.
 * Its row, and a photo picker open on it, is never thrown away and rebuilt
 * as it saves, so a photo chosen meanwhile is kept.
 */
export function damageItems(
  savedMarks: readonly SavedMark[],
  queued: readonly QueuedChange[],
  sentFromPhone: readonly MarkSentFromPhone[],
): DamageMarkItem[] {
  const phoneKeyOf = new Map(sentFromPhone.map((mark) => [mark.markId, mark.markKey]));
  const savedIds = new Set(savedMarks.map((mark) => mark.id));
  const forSaved = (markId: string, markKey?: string) => (target: QueuedPhotoTarget) =>
    ("damageMarkId" in target && target.damageMarkId === markId) ||
    (markKey !== undefined && "markKey" in target && target.markKey === markKey);

  const saved = savedMarks.map((mark) => ({
    key: phoneKeyOf.get(mark.id) ?? mark.id,
    serverId: mark.id,
    x: mark.x,
    y: mark.y,
    description: mark.description,
    photoState: photoStateOf(queued, mark.photo, forSaved(mark.id, phoneKeyOf.get(mark.id))),
  }));
  const savingNow = sentFromPhone
    .filter((mark) => !savedIds.has(mark.markId))
    .map((mark) => ({
      key: mark.markKey,
      serverId: mark.markId,
      x: mark.x,
      y: mark.y,
      description: mark.description,
      photoState: photoStateOf(queued, null, forSaved(mark.markId, mark.markKey)),
    }));
  const onPhone = queued.flatMap((change) =>
    change.kind === "mark"
      ? [
          {
            key: change.markKey,
            serverId: null,
            x: change.x,
            y: change.y,
            description: change.description,
            photoState: photoStateOf(
              queued,
              null,
              (target) => "markKey" in target && target.markKey === change.markKey,
            ),
          },
        ]
      : [],
  );
  return [...saved, ...savingNow, ...onPhone];
}
