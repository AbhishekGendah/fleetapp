import type { StorageArea } from "@fleetapp/core";

import type { FileStorage, UploadPermissionRequest } from "./file-storage";

const STAND_IN_UPLOAD_URL = "https://storage.test/upload";
const STAND_IN_VIEW_URL = "https://storage.test/view";

/** File storage kept in memory: the tests' stand-in for Amazon S3. */
export interface MemoryFileStorage extends FileStorage {
  /** What the browser would have sent, as if it had used the permission. */
  receive(area: StorageArea, key: string, bytes: Uint8Array): void;
  has(area: StorageArea, key: string): boolean;
  /** Every permission handed out, newest last. */
  readonly permissions: UploadPermissionRequest[];
}

export function createMemoryFileStorage(): MemoryFileStorage {
  const stored = new Map<string, Uint8Array>();
  const address = (area: StorageArea, key: string): string => `${area}:${key}`;
  const permissions: UploadPermissionRequest[] = [];

  return {
    permissions,
    async createUploadPermission(request) {
      permissions.push(request);
      return { url: STAND_IN_UPLOAD_URL, fields: { key: request.key } };
    },
    async findStoredSize(area, key) {
      return stored.get(address(area, key))?.byteLength ?? null;
    },
    async readStart(area, key, length) {
      return (stored.get(address(area, key)) ?? new Uint8Array()).slice(0, length);
    },
    async remove(area, key) {
      stored.delete(address(area, key));
    },
    async createViewUrl(area, key) {
      return `${STAND_IN_VIEW_URL}/${area}/${key}`;
    },
    receive(area, key, bytes) {
      stored.set(address(area, key), bytes);
    },
    has(area, key) {
      return stored.has(address(area, key));
    },
  };
}
