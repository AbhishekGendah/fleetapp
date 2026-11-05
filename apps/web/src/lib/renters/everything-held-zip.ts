import { Zip, ZipPassThrough } from "fflate";

import { readStoredFile } from "../files/read-stored-file";
import type { FileStorage } from "../storage/file-storage";
import type { EverythingHeld } from "./everything-held";

const WORKBOOK_PATH = "everything-held.xlsx";
const NOT_INCLUDED_PATH = "files-not-included.txt";
const NOT_INCLUDED_HEADING =
  "These files are held but could not be read just now. Download again to include them:\n";

/**
 * Everything held as a zip, sent piece by piece as each file is read, so a
 * Renter with many documents is never held in memory at once or cut off by
 * the host's response size limit. Files are stored as they are (PDFs and
 * photos are already compressed). A file that can't be read is listed in
 * files-not-included.txt rather than silently left out.
 */
export function everythingHeldZip(
  held: EverythingHeld,
  workbook: Uint8Array,
  storage: FileStorage,
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      const zip = new Zip((error, chunk, isFinal) => {
        if (error) {
          controller.error(error);
          return;
        }
        controller.enqueue(chunk);
        if (isFinal) {
          controller.close();
        }
      });
      const add = (path: string, bytes: Uint8Array) => {
        const entry = new ZipPassThrough(path);
        zip.add(entry);
        entry.push(bytes, true);
      };
      add(WORKBOOK_PATH, workbook);
      const notIncluded: string[] = [];
      for (const file of held.files) {
        const bytes = await readStoredFile(storage, file.area, file.key, "everything held");
        if (bytes) {
          add(file.path, bytes);
        } else {
          notIncluded.push(file.path);
        }
      }
      if (notIncluded.length > 0) {
        add(
          NOT_INCLUDED_PATH,
          new TextEncoder().encode(NOT_INCLUDED_HEADING + notIncluded.join("\n")),
        );
      }
      zip.end();
    },
  });
}
