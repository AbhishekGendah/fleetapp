/** About 1600px on the long edge is plenty for a photo or a logo (rule 21). */
export const MAX_IMAGE_EDGE_PX = 1600;
/** The small copy shown in a photo grid. */
export const THUMBNAIL_EDGE_PX = 400;
const JPEG_QUALITY = 0.85;

/** PNG and WebP keep transparency, which a logo often needs; everything else becomes JPEG. */
function outputTypeFor(inputType: string): string {
  return inputType === "image/png" || inputType === "image/webp" ? inputType : "image/jpeg";
}

/**
 * Shrinks an image on the device before it is sent, so uploads stay quick on
 * poor signal. Redrawing it also drops hidden details a phone adds to photos,
 * such as where it was taken. Null if this browser cannot read the image
 * (some cannot open iPhone HEIC photos).
 */
export async function shrinkImage(
  file: Blob,
  maxEdgePx: number = MAX_IMAGE_EDGE_PX,
): Promise<Blob | null> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    return null;
  }
  const scale = Math.min(1, maxEdgePx / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob(resolve, outputTypeFor(file.type), JPEG_QUALITY));
}
