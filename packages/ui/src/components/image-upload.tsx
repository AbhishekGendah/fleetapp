"use client";

import { useRef, useState } from "react";

import { shrinkImage } from "../lib/shrink-image";
import { Button } from "./button";
import { ExpiringImage } from "./expiring-image";
import { FormError } from "./form-message";
import { Label } from "./input";

const UNREADABLE_IMAGE_MESSAGE =
  "This image could not be opened here. Save it as a PNG or JPEG and try again.";

export interface ImageUploadProps {
  id: string;
  label: string;
  hint: string;
  /** A short-lived link to the current image, if there is one. */
  currentImageUrl: string | null;
  /** The file types the picker offers, e.g. "image/png,image/jpeg". */
  accept: string;
  /** Sends the shrunk image. Resolves to a message to show, or null when saved. */
  onUpload(image: Blob): Promise<string | null>;
  onRemove?(): Promise<void>;
}

/**
 * Choose, replace or remove one image. The image is shrunk on the device
 * first (rule 21); the app decides where it goes and checks it again.
 */
export function ImageUpload(props: ImageUploadProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function handleFileChosen(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setIsBusy(true);
    setMessage(null);
    const image = await shrinkImage(file);
    setMessage(image ? await props.onUpload(image) : UNREADABLE_IMAGE_MESSAGE);
    setIsBusy(false);
  }

  async function handleRemove(): Promise<void> {
    setIsBusy(true);
    await props.onRemove?.();
    setIsBusy(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <Label htmlFor={props.id}>{props.label}</Label>
      <div className="flex flex-wrap items-center gap-4">
        <div className="bg-muted flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-md border">
          {props.currentImageUrl ? (
            <ExpiringImage src={props.currentImageUrl} alt="" className="max-h-full max-w-full" />
          ) : (
            <span className="text-muted-foreground text-xs">None yet</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={isBusy}
            onClick={() => inputRef.current?.click()}
          >
            {isBusy ? "Saving…" : props.currentImageUrl ? "Replace" : "Choose image"}
          </Button>
          {props.currentImageUrl && props.onRemove ? (
            <Button type="button" variant="ghost" disabled={isBusy} onClick={handleRemove}>
              Remove
            </Button>
          ) : null}
        </div>
      </div>
      <input
        ref={inputRef}
        id={props.id}
        type="file"
        accept={props.accept}
        className="sr-only"
        onChange={(event) => void handleFileChosen(event)}
      />
      <p className="text-muted-foreground text-xs">{props.hint}</p>
      <FormError message={message} />
    </div>
  );
}
