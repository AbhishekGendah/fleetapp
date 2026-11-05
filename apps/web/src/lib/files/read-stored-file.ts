import { describeErrorForLog, type StorageArea } from "@fleetapp/core";

import type { FileStorage } from "../storage/file-storage";

/** Long enough for a large PDF from Sydney; a stuck read gives up and is reported as unread. */
const STORED_FILE_READ_TIMEOUT_MS = 30_000;

/**
 * A stored file's bytes, read through a short-lived view link, exactly as
 * stored; null if it can't be read. Only the error's type is logged, never
 * the address (it carries a signature).
 */
export async function readStoredFile(
  storage: FileStorage,
  area: StorageArea,
  key: string,
  purposeForLog: string,
): Promise<Uint8Array | null> {
  try {
    const response = await fetch(await storage.createViewUrl(area, key), {
      signal: AbortSignal.timeout(STORED_FILE_READ_TIMEOUT_MS),
    });
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
  } catch (error) {
    console.error(`Reading a stored file failed: ${purposeForLog}`, describeErrorForLog(error));
    return null;
  }
}
