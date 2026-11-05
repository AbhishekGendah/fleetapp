import { describe, expect, it } from "vitest";

import { damageItems } from "../src/app/rentals/[rentalId]/handover/damage-items";
import type { QueuedChange } from "../src/lib/handover/offline/queued-changes";

const INSPECTION_ID = "8f4b4f0e-0000-4000-8000-000000000001";
const MARK_ID = "8f4b4f0e-0000-4000-8000-000000000002";
const MARK_KEY = "phone-mark-1";
const DENT = { x: 0.5, y: 0.2, description: "Dent on bonnet" };

const queuedMark: QueuedChange = {
  kind: "mark",
  inspectionId: INSPECTION_ID,
  markKey: MARK_KEY,
  ...DENT,
  queuedAt: 1,
};
const sent = { markKey: MARK_KEY, markId: MARK_ID, ...DENT };
const savedMark = { id: MARK_ID, ...DENT, photo: null };

describe("the damage marks on a checklist", () => {
  it("keeps a phone-made mark's row the same from queued, through saving, to saved", () => {
    const queued = damageItems([], [queuedMark], []);
    // Out of the phone's queue, not yet in the page's saved list.
    const saving = damageItems([], [], [sent]);
    const saved = damageItems([savedMark], [], [sent]);

    expect([queued, saving, saved].map((items) => items.map((item) => item.key))).toEqual([
      [MARK_KEY],
      [MARK_KEY],
      [MARK_KEY],
    ]);
    expect(saving[0]).toMatchObject({ serverId: MARK_ID, photoState: { kind: "missing" } });
  });

  it("shows a photo taken while the mark saved as waiting, whichever way it points", () => {
    const photo = (target: { markKey: string } | { damageMarkId: string }): QueuedChange => ({
      kind: "photo",
      inspectionId: INSPECTION_ID,
      target,
      photo: new Blob(),
      thumbnail: new Blob(),
      queuedAt: 2,
    });

    expect(damageItems([], [photo({ markKey: MARK_KEY })], [sent])[0]?.photoState).toEqual({
      kind: "waiting",
    });
    expect(
      damageItems([savedMark], [photo({ damageMarkId: MARK_ID })], [sent])[0]?.photoState,
    ).toEqual({ kind: "waiting" });
  });

  it("keys a mark saved elsewhere by its own id, and shows it once", () => {
    const items = damageItems([savedMark], [], []);

    expect(items).toHaveLength(1);
    expect(items[0]?.key).toBe(MARK_ID);
  });
});
