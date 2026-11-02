import { formatFileSize, PICKED_PHOTO_MAX_BYTES } from "@fleetapp/core";
import { shrinkImage, THUMBNAIL_EDGE_PX } from "@fleetapp/ui/shrink-image";

const TOO_LARGE_MESSAGE = `That photo is too large (over ${formatFileSize(PICKED_PHOTO_MAX_BYTES)}).`;
const UNREADABLE_MESSAGE = "This photo could not be opened here. Save it as a JPEG and try again.";

/**
 * A photo shrunk on the phone (rule 21), and its small copy, ready to send;
 * or what to tell the person when it cannot be.
 */
export async function shrinkPhotoForUpload(
  file: Blob,
): Promise<{ photo: Blob; thumbnail: Blob } | { problem: string }> {
  if (file.size > PICKED_PHOTO_MAX_BYTES) {
    return { problem: TOO_LARGE_MESSAGE };
  }
  const [photo, thumbnail] = await Promise.all([
    shrinkImage(file),
    shrinkImage(file, THUMBNAIL_EDGE_PX),
  ]);
  return photo && thumbnail ? { photo, thumbnail } : { problem: UNREADABLE_MESSAGE };
}
