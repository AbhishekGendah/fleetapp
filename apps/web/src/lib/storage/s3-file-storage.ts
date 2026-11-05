import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { contentDisposition, type StorageArea } from "@fleetapp/core";

import { UPLOAD_PERMISSION_SECONDS, VIEW_LINK_SECONDS, type FileStorage } from "./file-storage";

/** Photos of rentals over a year old: instant to open, cheaper to keep (rule 23). */
const LONG_TERM_STORAGE_CLASS = "GLACIER_IR";

/** What S3 answers when a version condition (If-Match) no longer holds. */
const PRECONDITION_FAILED_STATUS = 412;

/**
 * Every view link tells the browser to keep no copy (review A7-7). The links
 * are signed afresh each time, so caching saved almost nothing, and a shared
 * office computer would otherwise keep licence pictures and contracts on disk.
 */
export const VIEW_CACHE_CONTROL = "private, no-store";

/** The smallest file an upload permission accepts: an empty file is never useful. */
const MINIMUM_UPLOAD_BYTES = 1;

export interface S3FileStorageConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  buckets: Readonly<Record<StorageArea, string>>;
  /**
   * Another S3-compatible service instead of Amazon: only the browser tests'
   * local stand-in (MinIO). Left out, Amazon's own address for the region is used.
   */
  endpoint?: string | undefined;
}

/**
 * How long one storage call may take before it gives up (review G3-7): a
 * hung call would otherwise hold the nightly run, and the invoice numbers it
 * has locked, until Vercel cuts the whole run off.
 */
const STORAGE_CONNECTION_TIMEOUT_MS = 5_000;
const STORAGE_REQUEST_TIMEOUT_MS = 30_000;

/** File storage on Amazon S3, in Sydney. Both buckets block all public access. */
export function createS3FileStorage(config: S3FileStorageConfig): FileStorage {
  const client = new S3Client({
    region: config.region,
    requestHandler: {
      connectionTimeout: STORAGE_CONNECTION_TIMEOUT_MS,
      requestTimeout: STORAGE_REQUEST_TIMEOUT_MS,
    },
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    // A stand-in serves buckets as paths (host/bucket), not as their own hosts.
    ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
  });
  const bucketFor = (area: StorageArea): string => config.buckets[area];

  return {
    async createUploadPermission({ area, key, contentType, maxBytes }) {
      // Amazon itself refuses a different address, type or size from these.
      const { url, fields } = await createPresignedPost(client, {
        Bucket: bucketFor(area),
        Key: key,
        Fields: { "Content-Type": contentType },
        Conditions: [
          ["content-length-range", MINIMUM_UPLOAD_BYTES, maxBytes],
          ["eq", "$Content-Type", contentType],
        ],
        Expires: UPLOAD_PERMISSION_SECONDS,
      });
      return { url, fields };
    },

    async inspect(area, key) {
      try {
        const head = await client.send(
          new HeadObjectCommand({ Bucket: bucketFor(area), Key: key }),
        );
        return head.ContentLength !== undefined && head.ETag
          ? { sizeBytes: head.ContentLength, version: head.ETag }
          : null;
      } catch (error) {
        if (error instanceof NotFound) {
          return null;
        }
        throw error;
      }
    },

    async readStart(area, key, length, version) {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: bucketFor(area),
          Key: key,
          Range: `bytes=0-${length - 1}`,
          IfMatch: version,
        }),
      );
      return response.Body ? await response.Body.transformToByteArray() : new Uint8Array();
    },

    async promote(area, fromKey, toKey, version) {
      const bucket = bucketFor(area);
      try {
        await client.send(
          new CopyObjectCommand({
            Bucket: bucket,
            Key: toKey,
            CopySource: `${bucket}/${encodeURIComponent(fromKey)}`,
            // Only the bytes that were checked: a swap since then is refused.
            CopySourceIfMatch: version,
          }),
        );
      } catch (error) {
        if (
          error instanceof S3ServiceException &&
          error.$metadata.httpStatusCode === PRECONDITION_FAILED_STATUS
        ) {
          return false;
        }
        throw error;
      }
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: fromKey }));
      return true;
    },

    async moveToLongTermStorage(area, key) {
      const bucket = bucketFor(area);
      // Copied onto itself with the new class: the same bytes and address, cheaper to keep.
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: key,
          CopySource: `${bucket}/${encodeURIComponent(key)}`,
          StorageClass: LONG_TERM_STORAGE_CLASS,
          MetadataDirective: "COPY",
        }),
      );
    },

    async save(area, key, bytes, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucketFor(area),
          Key: key,
          Body: bytes,
          ContentType: contentType,
          // Refused if anything is already there (S3 conditional writes).
          IfNoneMatch: "*",
        }),
      );
    },

    async remove(area, key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucketFor(area), Key: key }));
    },

    async createViewUrl(area, key, downloadName) {
      const command = new GetObjectCommand({
        Bucket: bucketFor(area),
        Key: key,
        ResponseCacheControl: VIEW_CACHE_CONTROL,
        // Shown in the browser, and saved or shared under this name.
        ResponseContentDisposition: downloadName
          ? contentDisposition("inline", downloadName)
          : undefined,
      });
      return getSignedUrl(client, command, { expiresIn: VIEW_LINK_SECONDS });
    },
  };
}
