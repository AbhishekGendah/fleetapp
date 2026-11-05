import { Zip, ZipPassThrough } from "fflate";

import { readStoredFile } from "../files/read-stored-file";
import type { FileStorage } from "../storage/file-storage";
import type { EverythingHeld } from "./everything-held";

const WORKBOOK_PATH = "everything-held.xlsx";
const NOT_INCLUDED_PATH = "files-not-included.txt";
const NOT_INCLUDED_HEADING =
  "These files are held but could not be read just now. Download again to include them:\n";

/**
 * Everything held as a zip, sent piece by piece: one stored file is read
 * only when the download has taken the last, so a Renter with many
 * documents is never held in memory at once nor cut off by the host's
 * response size limit. Files are stored as they are (PDFs and photos are
 * already compressed). A file that can't be read is listed in
 * files-not-included.txt rather than silently left out.
 */
export function everythingHeldZip(
  held: EverythingHeld,
  workbook: Uint8Array,
  storage: FileStorage,
): ReadableStream<Uint8Array> {
  let zip: Zip;
  let next = 0;
  const notIncluded: string[] = [];
  const add = (path: string, bytes: Uint8Array): void => {
    const entry = new ZipPassThrough(path);
    zip.add(entry);
    entry.push(bytes, true);
  };

  return new ReadableStream({
    start(controller) {
      zip = new Zip((error, chunk, isFinal) => {
        if (error) {
          controller.error(error);
          return;
        }
        controller.enqueue(chunk);
        if (isFinal) {
          controller.close();
        }
      });
      add(WORKBOOK_PATH, workbook);
    },
    async pull() {
      const file = held.files[next];
      next += 1;
      if (!file) {
        if (notIncluded.length > 0) {
          const list = NOT_INCLUDED_HEADING + notIncluded.join("\n");
          add(NOT_INCLUDED_PATH, new TextEncoder().encode(list));
        }
        zip.end();
        return;
      }
      const bytes = await readStoredFile(storage, file.area, file.key, "everything held");
      if (bytes) {
        add(file.path, bytes);
      } else {
        notIncluded.push(file.path);
      }
    },
  });
}
