import { ImageViewerOpener } from "@fleetapp/ui/image-viewer";
import { FileText, Image as ImageIcon } from "lucide-react";

const PDF_CONTENT_TYPE = "application/pdf";

/** Looks like something to tap: a bordered row with its icon. */
const FILE_ROW_CLASS =
  "text-teal hover:bg-muted flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md border px-3 text-sm font-medium sm:max-w-md";

export function isPdf(contentType: string): boolean {
  return contentType === PDF_CONTENT_TYPE;
}

/**
 * Opens a stored file: a PDF in the phone's own viewer, an image full screen
 * in the app (inside the surrounding `ImageViewer`, at `imageIndex`).
 */
export function FileLink(props: {
  href: string;
  label: string;
  contentType: string;
  imageIndex: number;
}) {
  if (isPdf(props.contentType)) {
    return (
      <a href={props.href} target="_blank" rel="noopener" className={FILE_ROW_CLASS}>
        <FileText className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{props.label}</span>
      </a>
    );
  }
  return (
    <ImageViewerOpener
      index={props.imageIndex}
      label={`Open ${props.label}`}
      className={FILE_ROW_CLASS}
    >
      <ImageIcon className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{props.label}</span>
    </ImageViewerOpener>
  );
}
