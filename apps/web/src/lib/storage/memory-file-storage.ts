import type { StorageArea } from "@fleetapp/core";

import type { FileStorage, UploadPermissionRequest } from "./file-storage";

const STAND_IN_UPLOAD_URL = "https://storage.test/upload";
const STAND_IN_VIEW_URL = "https://storage.test/view";

/** File storage kept in memory: the tests' stand-in for Amazon S3. */
export interface MemoryFileStorage extends FileStorage {
  /** What the browser would have sent, as if it had used the permission. */
  receive(area: StorageArea, key: string, bytes: Uint8Array): void;
  has(area: StorageArea, key: string): boolean;
  /** Everything stored at an address, for a test to check what was saved. */
  read(area: StorageArea, key: string): Uint8Array | undefined;
  /** Every permission handed out, newest last. */
  readonly permissions: UploadPermissionRequest[];
}

export function createMemoryFileStorage(): MemoryFileStorage {
  const stored = new Map<string, { bytes: Uint8Array; version: string }>();
  let versions = 0;
  const address = (area: StorageArea, key: string): string => `${area}:${key}`;
  const permissions: UploadPermissionRequest[] = [];

  return {
    permissions,
    async createUploadPermission(request) {
      permissions.push(request);
      return { url: STAND_IN_UPLOAD_URL, fields: { key: request.key } };
    },
    async inspect(area, key) {
      const found = stored.get(address(area, key));
      return found ? { sizeBytes: found.bytes.byteLength, version: found.version } : null;
    },
    async readStart(area, key, length, version) {
      const found = stored.get(address(area, key));
      if (found?.version !== version) {
        throw new Error("The stored file changed after it was inspected.");
      }
      return found.bytes.slice(0, length);
    },
    async promote(area, fromKey, toKey, version) {
      const found = stored.get(address(area, fromKey));
      if (found?.version !== version) {
        return false;
      }
      stored.set(address(area, toKey), found);
      stored.delete(address(area, fromKey));
      return true;
    },
    async save(area, key, bytes) {
      if (stored.has(address(area, key))) {
        throw new Error("Something is already stored at that address.");
      }
      versions += 1;
      stored.set(address(area, key), { bytes, version: String(versions) });
    },
    async remove(area, key) {
      stored.delete(address(area, key));
    },
    async createViewUrl(area, key, downloadName) {
      const name = downloadName ? `?name=${encodeURIComponent(downloadName)}` : "";
      return `${STAND_IN_VIEW_URL}/${area}/${key}${name}`;
    },
    receive(area, key, bytes) {
      versions += 1;
      stored.set(address(area, key), { bytes, version: String(versions) });
    },
    has(area, key) {
      return stored.has(address(area, key));
    },
    read(area, key) {
      return stored.get(address(area, key))?.bytes;
    },
  };
}
