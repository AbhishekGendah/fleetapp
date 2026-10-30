"use client";

import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import * as React from "react";

import { useCloseOnBack } from "../lib/use-close-on-back";
import { cn } from "../lib/utils";
import { Button } from "./button";

/** A sideways drag this long (in pixels) counts as a swipe to the next or previous image. */
const SWIPE_DISTANCE_PX = 50;

export interface ViewerImage {
  /** Where the full-size image is fetched from. */
  src: string;
  /** Shown above it, e.g. "1ABC234 2026-10-30 001". */
  label: string;
}

const OpenerContext = React.createContext<((index: number) => void) | null>(null);

function useSwipe(onPrevious: () => void, onNext: () => void) {
  const startX = React.useRef<number | null>(null);
  return {
    onPointerDown: (event: React.PointerEvent) => {
      startX.current = event.clientX;
    },
    onPointerUp: (event: React.PointerEvent) => {
      const distance = startX.current === null ? 0 : event.clientX - startX.current;
      startX.current = null;
      if (distance > SWIPE_DISTANCE_PX) {
        onPrevious();
      } else if (distance < -SWIPE_DISTANCE_PX) {
        onNext();
      }
    },
  };
}

/**
 * Opens images full screen inside the app, instead of in a separate browser
 * tab with no way back. ✕, Escape or the phone's back button closes it;
 * arrows, the keyboard or a swipe move between the images. Only the image
 * on screen is fetched, so opening one is a single view (some are logged).
 * "Open to save or share" hands the image to the phone's own viewer.
 * Wrap the thumbnails or links in this and make each an `ImageViewerOpener`.
 */
export function ImageViewer(props: {
  images: readonly ViewerImage[];
  children: React.ReactNode;
}): React.JSX.Element {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const [openIndex, setOpenIndex] = React.useState<number | null>(null);
  const count = props.images.length;
  const image = openIndex === null ? null : props.images[openIndex];
  const close = React.useCallback(() => dialogRef.current?.close(), []);
  useCloseOnBack(openIndex !== null, close);

  React.useEffect(() => {
    if (openIndex !== null && dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  }, [openIndex]);

  const step = (by: number) =>
    setOpenIndex((index) => (index === null ? null : (index + by + count) % count));
  const swipe = useSwipe(
    () => step(-1),
    () => step(1),
  );
  const hasSeveral = count > 1;

  return (
    <OpenerContext.Provider value={setOpenIndex}>
      {props.children}
      <dialog
        ref={dialogRef}
        aria-label={image?.label ?? "Image"}
        onClose={() => setOpenIndex(null)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            step(-1);
          } else if (event.key === "ArrowRight") {
            step(1);
          }
        }}
        className="m-0 h-dvh max-h-none w-full max-w-none bg-black p-0 text-white backdrop:bg-black"
      >
        {image ? (
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 px-2 pt-[max(0.25rem,env(safe-area-inset-top))]">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close"
                className="text-white hover:bg-white/15 hover:text-white"
                onClick={close}
              >
                <X className="size-6!" aria-hidden />
              </Button>
              <p className="min-w-0 flex-1 truncate text-sm font-medium">{image.label}</p>
              {hasSeveral ? (
                <p className="shrink-0 pr-2 text-sm text-white/70">
                  {(openIndex ?? 0) + 1} of {count}
                </p>
              ) : null}
            </div>
            <div className="relative min-h-0 flex-1 touch-pan-y select-none" {...swipe}>
              <img
                key={image.src}
                src={image.src}
                alt={image.label}
                draggable={false}
                className="size-full object-contain"
              />
              {hasSeveral ? (
                <>
                  <StepButton side="left" label="Previous" onClick={() => step(-1)} />
                  <StepButton side="right" label="Next" onClick={() => step(1)} />
                </>
              ) : null}
            </div>
            <div className="flex justify-center px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <Button
                asChild
                variant="ghost"
                className="text-white hover:bg-white/15 hover:text-white"
              >
                <a href={image.src} target="_blank" rel="noopener">
                  <ExternalLink aria-hidden />
                  Open to save or share
                </a>
              </Button>
            </div>
          </div>
        ) : null}
      </dialog>
    </OpenerContext.Provider>
  );
}

function StepButton(props: { side: "left" | "right"; label: string; onClick: () => void }) {
  const Icon = props.side === "left" ? ChevronLeft : ChevronRight;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={props.label}
      className={cn(
        "absolute top-1/2 -translate-y-1/2 rounded-full bg-black/40 text-white hover:bg-black/60 hover:text-white",
        props.side === "left" ? "left-2" : "right-2",
      )}
      onClick={props.onClick}
    >
      <Icon className="size-6!" aria-hidden />
    </Button>
  );
}

/** Opens the surrounding `ImageViewer` at one of its images: a thumbnail or a name. */
export function ImageViewerOpener(props: {
  index: number;
  /** Read out, e.g. "Open photo 1ABC234 2026-10-30 001". */
  label: string;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const open = React.useContext(OpenerContext);
  return (
    <button
      type="button"
      aria-label={props.label}
      className={cn(
        "focus-visible:ring-ring cursor-zoom-in rounded-md text-left focus-visible:ring-2 focus-visible:outline-none",
        props.className,
      )}
      onClick={() => open?.(props.index)}
    >
      {props.children}
    </button>
  );
}
