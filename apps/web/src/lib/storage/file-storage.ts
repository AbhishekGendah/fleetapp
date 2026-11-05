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

/** What arrived at an address: its size, and a fingerprint of exactly those bytes. */
export interface StoredObject {
  sizeBytes: number;
  /** Changes whenever the bytes do (S3's ETag), so a swap after checking is caught. */
  version: string;
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
  /** What is at an address, or null if nothing arrived. */
  inspect(area: StorageArea, key: string): Promise<StoredObject | null>;
  /** The first bytes of that exact version, to check what it really is; fails if it changed. */
  readStart(area: StorageArea, key: string, length: number, version: string): Promise<Uint8Array>;
  /**
   * Moves that exact version from where the browser sent it to the file's
   * own address, which no upload permission covers. False if the bytes
   * changed after they were checked; nothing is moved then.
   */
  promote(area: StorageArea, fromKey: string, toKey: string, version: string): Promise<boolean>;
  /**
   * Saves a file the app made itself, such as an issued PDF. Never replaces
   * what is already at the address: an issued document is never overwritten.
   */
  save(area: StorageArea, key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  remove(area: StorageArea, key: string): Promise<void>;
  /**
   * Keeps the file in cheaper long-term storage (S3 Glacier Instant
   * Retrieval): the same address, opened just as quickly (rule 23).
   */
  moveToLongTermStorage(area: StorageArea, key: string): Promise<void>;
  /**
   * A link that works for VIEW_LINK_SECONDS. With a name, saving or sharing
   * the file uses it rather than the storage address.
   */
  createViewUrl(area: StorageArea, key: string, downloadName?: string): Promise<string>;
}
