"use client";

import { PICKED_PHOTO_MAX_BYTES } from "@fleetapp/core";
import { Button } from "@fleetapp/ui/button";
import { CameraCapture } from "@fleetapp/ui/camera-capture";
import { FilePicker } from "@fleetapp/ui/file-picker";
import { FormError } from "@fleetapp/ui/form-message";
import { shrinkImage, THUMBNAIL_EDGE_PX } from "@fleetapp/ui/shrink-image";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { SEND_FAILED_MESSAGE, sendToStorage } from "../../../lib/files/send-to-storage";
import { finishCarPhotoUploadAction, startCarPhotoUploadAction } from "./file-actions";

const TOO_LARGE_MESSAGE = "That photo is too large (over 25 MB).";
const UNREADABLE_MESSAGE = "This photo could not be opened here. Save it as a JPEG and try again.";

/** One chosen photo on its way: shown until it is saved, with Try again if it fails. */
interface PendingPhoto {
  key: string;
  file: Blob;
  status: "sending" | "failed";
  message: string | null;
}

/** Shrinks a photo on the phone (rule 21) and sends it and its small copy. Null when saved. */
async function sendPhoto(vehicleId: string, file: Blob): Promise<string | null> {
  if (file.size > PICKED_PHOTO_MAX_BYTES) {
    return TOO_LARGE_MESSAGE;
  }
  const [photo, thumbnail] = await Promise.all([
    shrinkImage(file),
    shrinkImage(file, THUMBNAIL_EDGE_PX),
  ]);
  if (!photo || !thumbnail) {
    return UNREADABLE_MESSAGE;
  }
  const start = await startCarPhotoUploadAction(vehicleId, {
    photo: { contentType: photo.type, sizeBytes: photo.size },
    thumbnail: { contentType: thumbnail.type, sizeBytes: thumbnail.size },
  });
  if (start.status === "refused") {
    return start.message;
  }
  // A small copy that does not arrive is cleaned up later; the grid shows the photo instead.
  const [isPhotoSent] = await Promise.all([
    sendToStorage(start.photo.permission, photo),
    sendToStorage(start.thumbnail.permission, thumbnail),
  ]);
  if (!isPhotoSent) {
    return SEND_FAILED_MESSAGE;
  }
  return finishCarPhotoUploadAction(vehicleId, start.photo.fileId, start.thumbnail.fileId);
}

/**
 * Add photos: several at once, from the camera or gallery. Each goes on its
 * own, so one failing does not stop the rest; a failed one stays with Try
 * again. (A queue that survives losing signal comes with Phase 3.)
 */
export function PhotoUploads({ vehicleId }: { vehicleId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingPhoto[]>([]);

  function update(key: string, change: Partial<PendingPhoto> | null): void {
    setPending((previous) =>
      change === null
        ? previous.filter((item) => item.key !== key)
        : previous.map((item) => (item.key === key ? { ...item, ...change } : item)),
    );
  }

  async function send(item: PendingPhoto): Promise<void> {
    update(item.key, { status: "sending", message: null });
    const problem = await sendPhoto(vehicleId, item.file);
    if (problem) {
      update(item.key, { status: "failed", message: problem });
      return;
    }
    update(item.key, null);
    router.refresh();
  }

  // One after another, so photos are numbered in the order they were taken.
  async function sendInTurn(items: readonly PendingPhoto[]): Promise<void> {
    for (const item of items) {
      await send(item);
    }
  }

  function handlePhotosChosen(chosen: readonly Blob[]): void {
    const items = chosen.map((file) => ({
      key: crypto.randomUUID(),
      file,
      status: "sending" as const,
      message: null,
    }));
    setPending((previous) => [...previous, ...items]);
    void sendInTurn(items);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <CameraCapture triggerLabel="Take photos" onPhotosTaken={handlePhotosChosen} />
        <FilePicker
          label="Add from gallery"
          accept="image/*"
          isMultiple
          onFilesChosen={handlePhotosChosen}
        />
      </div>
      {pending.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {pending.map((item) => (
            <li
              key={item.key}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              {item.status === "sending" ? (
                <span className="text-muted-foreground">Sending a photo…</span>
              ) : (
                <>
                  <FormError message={item.message} />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void send(item)}
                    >
                      Try again
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => update(item.key, null)}
                    >
                      Leave it
                    </Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
