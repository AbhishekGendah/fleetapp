"use client";

import type { CAR_AREAS } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { CarAreaSelect, CarOutline } from "@fleetapp/ui/car-outline";
import { FilePicker } from "@fleetapp/ui/file-picker";
import { FormField } from "@fleetapp/ui/form-field";
import { FormError } from "@fleetapp/ui/form-message";
import { Input } from "@fleetapp/ui/input";
import { RecordItem, RecordList } from "@fleetapp/ui/record-list";
import { Camera, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import type { QueuedPhotoTarget } from "../../../../lib/handover/offline/queued-changes";
import { PhotoStatus, type PhotoState } from "./checklist-photos";

/** A mark on the outline: saved on the server (with an id), or still on the phone (a key). */
export interface DamageMarkItem {
  key: string;
  serverId: string | null;
  x: number;
  y: number;
  description: string;
  photoState: PhotoState;
}

const DESCRIPTION_NEEDED = "Say what the damage is, e.g. scratch on the bonnet.";
const PLACE_NEEDED = "Tap the outline where the damage is, or choose the area.";

/**
 * Damage already on the car: tap the outline (or choose the area, for the
 * keyboard), describe it and add it; then photograph each mark. Marks are
 * kept on the phone until there is signal, like the photos.
 */
/** Damage the handover found, shown greyed at a return; letters keep it apart from new damage. */
export interface ExistingMark {
  id: string;
  x: number;
  y: number;
  description: string;
}

const letterOf = (index: number): string => String.fromCharCode("A".charCodeAt(0) + index);

export function ChecklistDamage(props: {
  marks: readonly DamageMarkItem[];
  existingMarks?: readonly ExistingMark[];
  onAdd: (mark: { x: number; y: number; description: string }) => Promise<void>;
  onRemove: (serverId: string) => Promise<void>;
  onTake: (target: QueuedPhotoTarget, file: File) => Promise<void>;
}) {
  const [place, setPlace] = useState<{ x: number; y: number } | null>(null);
  const [area, setArea] = useState("");
  const [description, setDescription] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  function handleAreaChosen(picked: (typeof CAR_AREAS)[number] | null): void {
    setArea(picked?.key ?? "");
    setPlace(picked ? { x: picked.x, y: picked.y } : null);
  }

  async function handleAdd(): Promise<void> {
    if (!place) {
      setProblem(PLACE_NEEDED);
      return;
    }
    if (description.trim() === "") {
      setProblem(DESCRIPTION_NEEDED);
      return;
    }
    setProblem(null);
    await props.onAdd({ ...place, description: description.trim() });
    setPlace(null);
    setArea("");
    setDescription("");
  }

  const existing = props.existingMarks ?? [];
  const outlineMarks = [
    ...existing.map((mark, index) => ({
      id: `existing-${mark.id}`,
      x: mark.x,
      y: mark.y,
      label: `Already there at handover, ${letterOf(index)}: ${mark.description}`,
      badge: letterOf(index),
      tone: "existing" as const,
    })),
    ...props.marks.map((mark, index) => ({
      id: mark.key,
      x: mark.x,
      y: mark.y,
      label: `Damage ${index + 1}: ${mark.description}`,
    })),
    ...(place
      ? [{ id: "new", x: place.x, y: place.y, label: "New damage mark, not added yet" }]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <CarOutline
        label="Car outline: tap where the damage is"
        marks={outlineMarks}
        onPlace={(position) => {
          setArea("");
          setPlace(position);
        }}
      />
      {existing.length > 0 ? (
        <div className="text-muted-foreground text-sm">
          <p className="font-medium">Already there at handover (greyed):</p>
          <ul className="list-inside list-disc">
            {existing.map((mark, index) => (
              <li key={mark.id}>
                {letterOf(index)}. {mark.description}
              </li>
            ))}
          </ul>
          <p>Mark only damage that is new.</p>
        </div>
      ) : null}
      <FormField htmlFor="damage-area" label="Or choose where on the car">
        <CarAreaSelect id="damage-area" value={area} onAreaChosen={handleAreaChosen} />
      </FormField>
      <FormField htmlFor="damage-description" label="What is the damage?">
        <Input
          id="damage-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={200}
        />
      </FormField>
      <FormError message={problem} />
      <Button
        type="button"
        variant="outline"
        onClick={() => void handleAdd()}
        className="sm:self-start"
      >
        <Plus aria-hidden />
        Add damage mark
      </Button>
      {props.marks.length > 0 ? (
        <RecordList label="Damage marked">
          {props.marks.map((mark, index) => (
            <RecordItem
              key={mark.key}
              title={`${index + 1}. ${mark.description}`}
              aside={<PhotoStatus state={mark.photoState} />}
              details={
                mark.photoState.kind === "saved" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a short-lived private address
                  <img
                    src={mark.photoState.photo.viewUrl}
                    alt={`Damage ${index + 1} photo`}
                    className="h-24 w-32 rounded object-cover"
                  />
                ) : mark.serverId ? null : (
                  <span>Waiting to send</span>
                )
              }
              actions={
                <>
                  <FilePicker
                    label="Take photo"
                    accessibleName={`Take photo: damage ${index + 1}`}
                    accept="image/*"
                    icon={<Camera aria-hidden />}
                    onFilesChosen={([file]) =>
                      file &&
                      void props.onTake(
                        mark.serverId ? { damageMarkId: mark.serverId } : { markKey: mark.key },
                        file,
                      )
                    }
                  />
                  {mark.serverId ? (
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => void props.onRemove(mark.serverId!)}
                    >
                      <Trash2 aria-hidden />
                      Remove mark {index + 1}
                    </Button>
                  ) : null}
                </>
              }
            />
          ))}
        </RecordList>
      ) : null}
    </div>
  );
}
