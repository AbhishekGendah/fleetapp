import { env } from "../../env";
import { createS3FileStorage } from "./s3-file-storage";

/** The Operator app's file storage. Server only: it holds the storage key. */
export const appFileStorage = createS3FileStorage({
  region: env.FILE_STORAGE_REGION,
  accessKeyId: env.FILE_STORAGE_ACCESS_KEY_ID,
  secretAccessKey: env.FILE_STORAGE_SECRET_ACCESS_KEY,
  buckets: { general: env.STORAGE_BUCKET, identity: env.IDENTITY_STORAGE_BUCKET },
});
