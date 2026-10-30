import { shrinkImage } from "@fleetapp/ui/shrink-image";

import type { UploadPermission } from "../storage/file-storage";
import { SEND_FAILED_MESSAGE, sendToStorage } from "./send-to-storage";

const UNREADABLE_MESSAGE = "This image could not be opened here. Save it as a PDF and try again.";

type PaperUploadStart =
  | { status: "allowed"; fileId: string; permission: UploadPermission }
  | { status: "refused"; message: string };

/**
 * Sends a paper (a PDF, or a photo of one) the way every document and
 * attachment goes: images shrunk on the phone first (rule 21), then asked
 * for, sent straight to storage, and checked. Null when saved.
 */
export async function sendPaper(
  file: File,
  start: (planned: { contentType: string; sizeBytes: number }) => Promise<PaperUploadStart>,
  finish: (fileId: string) => Promise<string | null>,
): Promise<string | null> {
  const upload = file.type.startsWith("image/") ? await shrinkImage(file) : file;
  if (!upload) {
    return UNREADABLE_MESSAGE;
  }
  const started = await start({ contentType: upload.type, sizeBytes: upload.size });
  if (started.status === "refused") {
    return started.message;
  }
  if (!(await sendToStorage(started.permission, upload))) {
    return SEND_FAILED_MESSAGE;
  }
  return finish(started.fileId);
}
