"use client";

import { Badge } from "@fleetapp/ui/badge";
import { FilePicker } from "@fleetapp/ui/file-picker";
import { FormError } from "@fleetapp/ui/form-message";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";
import { Camera } from "lucide-react";
import { useState } from "react";

import { shrinkPhotoForUpload } from "../../../../lib/files/shrink-photo";
import type { QueuedPhotoTarget } from "../../../../lib/handover/offline/queued-changes";
import type { SavedPhoto } from "./checklist-data";

const PHOTO_TYPES = "image/*";

/** Where a photo stands: on the server, waiting on the phone, or not taken. */
export type PhotoState =
  { kind: "saved"; photo: SavedPhoto } | { kind: "waiting" } | { kind: "missing" };

/** Takes a photo, shrinks it on the phone and puts it in the queue; null when queued. */
export function useTakePhoto(
  queuePhoto: (target: QueuedPhotoTarget, files: { photo: Blob; thumbnail: Blob }) => Promise<void>,
): { take: (target: QueuedPhotoTarget, file: File) => Promise<void>; problem: string | null } {
  const [problem, setProblem] = useState<string | null>(null);
  async function take(target: QueuedPhotoTarget, file: File): Promise<void> {
    const shrunk = await shrinkPhotoForUpload(file);
    if ("problem" in shrunk) {
      setProblem(shrunk.problem);
      return;
    }
    setProblem(null);
    await queuePhoto(target, shrunk);
  }
  return { take, problem };
}

export function PhotoStatus({ state }: { state: PhotoState }) {
  if (state.kind === "saved") {
    return <Badge tone="good">Saved</Badge>;
  }
  return state.kind === "waiting" ? (
    <Badge tone="attention">Waiting to send</Badge>
  ) : (
    <Badge>Not taken</Badge>
  );
}

/** The photos on the list: each one taken (or taken again) with the camera. */
export function ChecklistPhotos(props: {
  photoNames: readonly string[];
  stateOf: (name: string) => PhotoState;
  onTake: (target: QueuedPhotoTarget, file: File) => Promise<void>;
  problem: string | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      <RecordList label="Photos to take">
        {props.photoNames.map((name) => {
          const state = props.stateOf(name);
          return (
            <RecordItem
              key={name}
              title={name}
              aside={<PhotoStatus state={state} />}
              details={
                state.kind === "saved" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a short-lived private address
                  <img
                    src={state.photo.viewUrl}
                    alt={`${name} photo`}
                    className="h-24 w-auto rounded"
                  />
                ) : null
              }
              actions={
                <FilePicker
                  label={state.kind === "missing" ? "Take photo" : "Retake"}
                  accessibleName={`${state.kind === "missing" ? "Take photo" : "Retake"}: ${name}`}
                  accept={PHOTO_TYPES}
                  icon={<Camera aria-hidden />}
                  onFilesChosen={([file]) => file && void props.onTake({ photoName: name }, file)}
                />
              }
            />
          );
        })}
      </RecordList>
      <FormError message={props.problem} />
    </div>
  );
}
