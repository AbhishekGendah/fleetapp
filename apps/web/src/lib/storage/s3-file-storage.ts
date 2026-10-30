import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageArea } from "@fleetapp/core";

import { UPLOAD_PERMISSION_SECONDS, VIEW_LINK_SECONDS, type FileStorage } from "./file-storage";

/** The smallest file an upload permission accepts: an empty file is never useful. */
const MINIMUM_UPLOAD_BYTES = 1;

export interface S3FileStorageConfig {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  buckets: Readonly<Record<StorageArea, string>>;
}

/** File storage on Amazon S3, in Sydney. Both buckets block all public access. */
export function createS3FileStorage(config: S3FileStorageConfig): FileStorage {
  const client = new S3Client({
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
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

    async findStoredSize(area, key) {
      try {
        const head = await client.send(
          new HeadObjectCommand({ Bucket: bucketFor(area), Key: key }),
        );
        return head.ContentLength ?? null;
      } catch (error) {
        if (error instanceof NotFound) {
          return null;
        }
        throw error;
      }
    },

    async readStart(area, key, length) {
      const response = await client.send(
        new GetObjectCommand({ Bucket: bucketFor(area), Key: key, Range: `bytes=0-${length - 1}` }),
      );
      return response.Body ? await response.Body.transformToByteArray() : new Uint8Array();
    },

    async remove(area, key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucketFor(area), Key: key }));
    },

    async createViewUrl(area, key, downloadName) {
      const command = new GetObjectCommand({
        Bucket: bucketFor(area),
        Key: key,
        // Shown in the browser, and saved or shared under this name.
        ResponseContentDisposition: downloadName
          ? `inline; filename*=UTF-8''${encodeURIComponent(downloadName)}`
          : undefined,
      });
      return getSignedUrl(client, command, { expiresIn: VIEW_LINK_SECONDS });
    },
  };
}
