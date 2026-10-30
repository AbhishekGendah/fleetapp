"use client";

import * as React from "react";

import { useCloseOnBack } from "../lib/use-close-on-back";
import { Button } from "./button";
import { FormError } from "./form-message";

const PHOTO_QUALITY = 0.9;
/** The camera is asked for about this size; phones give the nearest they can. */
const IDEAL_WIDTH_PX = 1920;
const IDEAL_HEIGHT_PX = 1440;
const FLASH_MS = 150;

const NO_CAMERA_MESSAGE =
  "The camera could not be opened. Allow this app to use the camera in your phone's settings, or use Add photos instead.";

interface TakenPhoto {
  key: string;
  blob: Blob;
  previewUrl: string;
}

interface CameraCaptureProps {
  /** On the button that opens the camera, e.g. "Take photos". */
  triggerLabel: string;
  /** Before the label, e.g. a camera. */
  triggerIcon?: React.ReactNode;
  /** The photos taken, in order, once Done is pressed. */
  onPhotosTaken(photos: Blob[]): void;
}

/** Turns the camera on while open, and off again when closed. */
function useCamera(isOpen: boolean, videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [problem, setProblem] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    let stream: MediaStream | null = null;
    let isStopped = false;
    const constraints: MediaStreamConstraints = {
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: IDEAL_WIDTH_PX },
        height: { ideal: IDEAL_HEIGHT_PX },
      },
    };
    setProblem(null);
    (navigator.mediaDevices?.getUserMedia(constraints) ?? Promise.reject(new Error("no camera")))
      .then((opened) => {
        if (isStopped) {
          opened.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = opened;
        if (videoRef.current) {
          videoRef.current.srcObject = opened;
        }
      })
      .catch((error: unknown) => {
        console.warn("The camera did not open", error instanceof Error ? error.name : "unknown");
        setProblem(NO_CAMERA_MESSAGE);
      });
    return () => {
      isStopped = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [isOpen, videoRef]);

  return problem;
}

/** One frame of the live picture, as a JPEG. */
function snapshot(video: HTMLVideoElement): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d")?.drawImage(video, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", PHOTO_QUALITY));
}

/**
 * A camera inside the app: take as many photos as needed without leaving it,
 * see each one in a strip along the bottom, take a bad one out, then Done
 * hands them all over. Full screen, on the phone's back camera. The phone
 * asks once for permission to use the camera.
 */
export function CameraCapture(props: CameraCaptureProps): React.JSX.Element {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [isOpen, setIsOpen] = React.useState(false);
  const [photos, setPhotos] = React.useState<TakenPhoto[]>([]);
  const [isFlashing, setIsFlashing] = React.useState(false);
  const problem = useCamera(isOpen, videoRef);
  useCloseOnBack(isOpen, () => dialogRef.current?.close());

  React.useEffect(() => {
    if (isOpen && dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  }, [isOpen]);

  function discardAll(): void {
    photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    setPhotos([]);
  }

  function close(): void {
    dialogRef.current?.close();
  }

  async function handleShutter(): Promise<void> {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) {
      return;
    }
    setIsFlashing(true);
    setTimeout(() => setIsFlashing(false), FLASH_MS);
    const blob = await snapshot(video);
    if (blob) {
      const photo = { key: crypto.randomUUID(), blob, previewUrl: URL.createObjectURL(blob) };
      setPhotos((previous) => [...previous, photo]);
    }
  }

  function handleRemove(key: string): void {
    const removed = photos.find((photo) => photo.key === key);
    if (removed) {
      URL.revokeObjectURL(removed.previewUrl);
    }
    setPhotos((previous) => previous.filter((photo) => photo.key !== key));
  }

  function handleDone(): void {
    props.onPhotosTaken(photos.map((photo) => photo.blob));
    discardAll();
    close();
  }

  return (
    <>
      <Button type="button" className="sm:self-start" onClick={() => setIsOpen(true)}>
        {props.triggerIcon}
        {props.triggerLabel}
      </Button>
      <dialog
        ref={dialogRef}
        aria-label="Camera"
        onClose={() => {
          discardAll();
          setIsOpen(false);
        }}
        className="m-0 h-dvh max-h-none w-full max-w-none bg-black p-0 text-white backdrop:bg-black"
      >
        <div className="flex h-full flex-col">
          <div className="relative min-h-0 flex-1">
            {/* Muted and inline, so phones play it in the page rather than full screen. */}
            <video ref={videoRef} autoPlay muted playsInline className="size-full object-contain" />
            {isFlashing ? <div className="absolute inset-0 bg-white/60" /> : null}
            {problem ? (
              <div className="bg-background absolute inset-x-4 top-4 rounded-md p-3">
                <FormError message={problem} />
              </div>
            ) : null}
          </div>
          {photos.length === 0 ? null : (
            <ul className="flex gap-3 overflow-x-auto px-3 pt-3 pb-2" aria-label="Photos taken">
              {photos.map((photo, index) => (
                <li key={photo.key} className="relative shrink-0">
                  <img
                    src={photo.previewUrl}
                    alt={`Photo ${index + 1}`}
                    className="size-20 rounded object-cover"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    aria-label={`Take out photo ${index + 1}`}
                    className="absolute -top-2 -right-2 size-11 rounded-full p-0 text-base"
                    onClick={() => handleRemove(photo.key)}
                  >
                    ×
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-3 items-center gap-2 px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button type="button" variant="ghost" className="text-white" onClick={close}>
              Cancel
            </Button>
            <Button
              type="button"
              aria-label="Take a photo"
              disabled={problem !== null}
              className="mx-auto size-18 rounded-full border-4 border-white bg-white/20 p-0"
              onClick={() => void handleShutter()}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={photos.length === 0}
              onClick={handleDone}
            >
              Done{photos.length > 0 ? ` (${photos.length})` : ""}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
