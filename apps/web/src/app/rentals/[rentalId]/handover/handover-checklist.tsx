"use client";

import { Button } from "@fleetapp/ui/button";
import { FormSection } from "@fleetapp/ui/form-section";
import { CloudOff, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import type { QueuedPhotoTarget } from "../../../../lib/handover/offline/queued-changes";
import { removeDamageMarkAction } from "./actions";
import type { ChecklistData, SavedMark, SavedPhoto } from "./checklist-data";
import { ChecklistDamage } from "./checklist-damage";
import { ChecklistDetails } from "./checklist-details";
import { ChecklistPhotos, useTakePhoto, type PhotoState } from "./checklist-photos";
import { damageItems, isWaitingFor } from "./damage-items";
import { gapsMessage } from "./handover-state";
import { useHandoverQueue, type QueueState } from "./use-handover-queue";

function SyncStatus({
  count,
  state,
  onSendNow,
}: {
  count: number;
  state: QueueState;
  onSendNow: () => void;
}) {
  if (count === 0) {
    return null;
  }
  return (
    <div role="status" className="bg-attention-soft flex flex-col gap-2 rounded-lg p-3 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <CloudOff aria-hidden className="size-4" />
        {count} waiting to send.{" "}
        {state.status === "sending" ? "Sending…" : "They send themselves when there is signal."}
      </p>
      {state.status === "waiting" ? <p>{state.problem}</p> : null}
      <Button type="button" variant="outline" onClick={onSendNow} className="sm:self-start">
        <RefreshCw aria-hidden />
        Send now
      </Button>
    </div>
  );
}

/** At a return: what the handover found, to compare each step with. */
export interface HandoverComparison {
  photos: Record<string, SavedPhoto>;
  marks: SavedMark[];
  fuelLabel: string | null;
}

/**
 * A checklist on the Operator's phone, the handover's or the return's:
 * photos, details, damage, then the last step (the Renter's acceptance, or
 * finishing the return). Everything is kept on the phone first and sent
 * when there is signal (rule 25); the last step needs the server to have
 * it all, as the report is made from what the server holds. A return shows
 * the handover beside each step.
 */
/** The Renter signs only what is saved, so a changed detail is saved first (review G9-2). */
const UNSAVED_DETAILS_MESSAGE =
  "The kilometres, fuel or keys have changed: press Save details before the Renter signs.";

export function HandoverChecklist({
  data,
  lastKilometres,
  comparison,
  damageTitle,
  finalStep,
}: {
  data: ChecklistData;
  lastKilometres: number | null;
  comparison?: HandoverComparison;
  damageTitle: string;
  finalStep: { title: string; form: ReactNode };
}) {
  const router = useRouter();
  const { queued, sentFromPhone, settleMarks, state, enqueue, sendNow } = useHandoverQueue(
    data.inspectionId,
  );
  const savedMarkIds = data.marks.map((mark) => mark.id).join(",");
  useEffect(() => {
    settleMarks(savedMarkIds === "" ? [] : savedMarkIds.split(","));
  }, [savedMarkIds, settleMarks]);
  const queuePhoto = useCallback(
    (target: QueuedPhotoTarget, files: { photo: Blob; thumbnail: Blob }) =>
      enqueue({ kind: "photo", inspectionId: data.inspectionId, target, ...files }),
    [enqueue, data.inspectionId],
  );
  const { take, problem } = useTakePhoto(queuePhoto);

  function photoState(name: string): PhotoState {
    if (isWaitingFor(queued, (target) => "photoName" in target && target.photoName === name)) {
      return { kind: "waiting" };
    }
    const photo = data.photos[name];
    return photo ? { kind: "saved", photo } : { kind: "missing" };
  }

  async function handleRemoveMark(markId: string): Promise<void> {
    await removeDamageMarkAction(data.rentalId, data.inspectionId, markId);
    // Never shown again from the phone's memory, even before the page refreshes.
    settleMarks([markId]);
    router.refresh();
  }

  const [hasUnsavedDetails, setHasUnsavedDetails] = useState(false);
  const isReady =
    data.gaps.length === 0 &&
    queued.length === 0 &&
    data.blockers.length === 0 &&
    !hasUnsavedDetails;
  return (
    <div className="flex flex-col gap-8">
      <SyncStatus count={queued.length} state={state} onSendNow={sendNow} />
      <FormSection title="1. Photos">
        <ChecklistPhotos
          photoNames={data.photoNames}
          stateOf={photoState}
          handoverPhotoOf={comparison ? (name) => comparison.photos[name] : undefined}
          onTake={take}
          problem={problem}
        />
      </FormSection>
      <FormSection title="2. Kilometres, fuel and keys">
        <ChecklistDetails
          rentalId={data.rentalId}
          inspectionId={data.inspectionId}
          initialValues={data.details}
          lastKilometres={lastKilometres}
          handoverFuel={comparison?.fuelLabel}
          onUnsavedChange={setHasUnsavedDetails}
        />
      </FormSection>
      <FormSection title={`3. ${damageTitle}`}>
        <ChecklistDamage
          marks={damageItems(data.marks, queued, sentFromPhone)}
          existingMarks={comparison?.marks}
          onAdd={(mark) =>
            enqueue({
              kind: "mark",
              inspectionId: data.inspectionId,
              markKey: crypto.randomUUID(),
              ...mark,
            })
          }
          onRemove={handleRemoveMark}
          onTake={take}
        />
      </FormSection>
      <FormSection title={`4. ${finalStep.title}`}>
        {isReady ? (
          finalStep.form
        ) : (
          <div className="text-muted-foreground flex flex-col gap-1 text-sm">
            {data.gaps.length > 0 ? <p>{gapsMessage(data.gaps)}</p> : null}
            {queued.length > 0 ? <p>Some photos or marks are still waiting to send.</p> : null}
            {hasUnsavedDetails ? <p>{UNSAVED_DETAILS_MESSAGE}</p> : null}
            {data.blockers.map((blocker) => (
              <p key={blocker}>{blocker}</p>
            ))}
          </div>
        )}
      </FormSection>
    </div>
  );
}
