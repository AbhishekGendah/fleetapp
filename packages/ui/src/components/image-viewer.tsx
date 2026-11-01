"use client";

import { ExternalLink } from "lucide-react";
import * as React from "react";
import Lightbox from "yet-another-react-lightbox";
import Captions from "yet-another-react-lightbox/plugins/captions";
import Counter from "yet-another-react-lightbox/plugins/counter";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/captions.css";
import "yet-another-react-lightbox/plugins/counter.css";

import { useCloseOnBack } from "../lib/use-close-on-back";
import { cn } from "../lib/utils";

export interface ViewerImage {
  /** Where the full-size image is fetched from. */
  src: string;
  /** Shown above it, e.g. "1ABC234 2026-10-30 001". */
  label: string;
}

/**
 * Only the image on screen is fetched, never its neighbours ahead of time:
 * opening a licence photo is a logged view (rule 8), so each fetch must be one.
 */
const NO_PRELOADING = 0;

const VIEWER_LABELS = {
  Previous: "Previous",
  Next: "Next",
  Close: "Close",
  Lightbox: "Image viewer",
} as const;

const OpenerContext = React.createContext<((index: number) => void) | null>(null);

/** Hands the image to the phone's own viewer, where it can be saved or shared. */
function OpenToSaveButton(props: { image: ViewerImage | undefined }): React.JSX.Element | null {
  if (!props.image) {
    return null;
  }
  return (
    <a
      href={props.image.src}
      target="_blank"
      rel="noopener"
      className="yarl__button inline-flex min-h-11 items-center gap-2 text-sm font-medium"
    >
      <ExternalLink aria-hidden className="size-5" />
      Open to save or share
    </a>
  );
}

/**
 * Opens images full screen inside the app, instead of in a separate browser
 * tab with no way back, using yet-another-react-lightbox: ✕, Escape or the
 * phone's back button closes it; arrows, the keyboard or a swipe move
 * between the images; pinch or double-tap zooms. "Open to save or share"
 * hands the image to the phone's own viewer.
 * Wrap the thumbnails or links in this and make each an `ImageViewerOpener`.
 */
export function ImageViewer(props: {
  images: readonly ViewerImage[];
  children: React.ReactNode;
}): React.JSX.Element {
  const [openIndex, setOpenIndex] = React.useState<number | null>(null);
  const close = React.useCallback(() => setOpenIndex(null), []);
  useCloseOnBack(openIndex !== null, close);
  const slides = props.images.map((image) => ({
    src: image.src,
    alt: image.label,
    title: image.label,
  }));
  const isSingle = props.images.length <= 1;

  return (
    <OpenerContext.Provider value={setOpenIndex}>
      {props.children}
      <Lightbox
        open={openIndex !== null}
        index={openIndex ?? 0}
        close={close}
        slides={slides}
        labels={VIEWER_LABELS}
        plugins={[Captions, Counter, Zoom]}
        carousel={{ preload: NO_PRELOADING, finite: isSingle }}
        counter={{ separator: " of " }}
        controller={{ closeOnBackdropClick: false }}
        render={isSingle ? { buttonPrev: () => null, buttonNext: () => null } : undefined}
        on={{ view: ({ index }) => setOpenIndex(index) }}
        toolbar={{
          buttons: [<OpenToSaveButton key="open" image={props.images[openIndex ?? 0]} />, "close"],
        }}
      />
    </OpenerContext.Provider>
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
