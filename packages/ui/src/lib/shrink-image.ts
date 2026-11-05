import Compressor from "compressorjs";

/** About 1600px on the long edge is plenty for a photo or a logo (rule 21). */
export const MAX_IMAGE_EDGE_PX = 1600;
/** The small copy shown in a photo grid. */
export const THUMBNAIL_EDGE_PX = 400;
const JPEG_QUALITY = 0.85;

const JPEG = "image/jpeg";
const PNG = "image/png";
const TYPES_WITH_TRANSPARENCY: ReadonlySet<string> = new Set([PNG, "image/webp"]);

export interface ShrinkOptions {
  maxEdgePx?: number;
  /**
   * Keep a see-through background (a logo): such a picture becomes PNG.
   * Otherwise everything becomes JPEG, which every PDF can hold (review G9-7).
   */
  keepsTransparency?: boolean;
}

function outputTypeFor(inputType: string, keepsTransparency: boolean): string {
  return keepsTransparency && TYPES_WITH_TRANSPARENCY.has(inputType) ? PNG : JPEG;
}

/**
 * Shrinks an image on the device before it is sent, so uploads stay quick on
 * poor signal, with Compressor.js: it turns phone photos the right way up and
 * drops hidden details a phone adds, such as where it was taken. Null if this
 * browser cannot read the image (some cannot open iPhone HEIC photos).
 */
export function shrinkImage(file: Blob, options: ShrinkOptions = {}): Promise<Blob | null> {
  const maxEdgePx = options.maxEdgePx ?? MAX_IMAGE_EDGE_PX;
  return new Promise((resolve) => {
    new Compressor(file, {
      maxWidth: maxEdgePx,
      maxHeight: maxEdgePx,
      quality: JPEG_QUALITY,
      mimeType: outputTypeFor(file.type, options.keepsTransparency ?? false),
      // Our own rule above decides the type, not Compressor's size-based switch to JPEG.
      convertSize: Number.POSITIVE_INFINITY,
      checkOrientation: true,
      retainExif: false,
      success: resolve,
      error: (error) => {
        console.warn("A photo could not be shrunk on this device", error.name);
        resolve(null);
      },
    });
  });
}
