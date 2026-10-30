import type { StorageArea } from "@fleetapp/core";

/** How long the browser has to send a file once allowed. */
export const UPLOAD_PERMISSION_SECONDS = 10 * 60;
/** How long a link to view a file works. Files are never public (rule 8). */
export const VIEW_LINK_SECONDS = 5 * 60;

/** What the browser sends a file with: an address, and the signed form fields to post with it. */
export interface UploadPermission {
  url: string;
  fields: Record<string, string>;
}

export interface UploadPermissionRequest {
  area: StorageArea;
  key: string;
  contentType: string;
  maxBytes: number;
}

/**
 * Where files are kept. The app only ever talks to this, so the tests run
 * against a stand-in and the provider could change without touching it.
 */
export interface FileStorage {
  /** A one-time permission for one address, one type and a size limit. */
  createUploadPermission(request: UploadPermissionRequest): Promise<UploadPermission>;
  /** The stored size, or null if nothing arrived. */
  findStoredSize(area: StorageArea, key: string): Promise<number | null>;
  /** The first bytes of a stored file, to check what it really is. */
  readStart(area: StorageArea, key: string, length: number): Promise<Uint8Array>;
  remove(area: StorageArea, key: string): Promise<void>;
  /**
   * A link that works for VIEW_LINK_SECONDS. With a name, saving or sharing
   * the file uses it rather than the storage address.
   */
  createViewUrl(area: StorageArea, key: string, downloadName?: string): Promise<string>;
}
