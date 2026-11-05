import { imageSize } from "image-size";

/** How big a picture may be, in pixels, before it is drawn into a PDF. */
export interface PictureLimits {
  width: number;
  height: number;
}

/**
 * Generous for a signature drawn on any phone or tablet at its screen's
 * full sharpness; a doctored one far bigger would freeze the server while
 * its PDF is made (review G5-1).
 */
export const DRAWN_SIGNATURE_LIMITS: PictureLimits = { width: 4000, height: 2000 };

/**
 * Any picture printed in a PDF (a logo, a checklist photo). Photos are
 * shrunk to about 1600 pixels on the phone (rule 21) and logos on the logo
 * screen, so only a doctored file is ever bigger (review G5-2).
 */
export const PDF_PICTURE_LIMITS: PictureLimits = { width: 4000, height: 4000 };

/**
 * Whether a picture's own header says it fits the limits. Read from the
 * header alone, so a doctored file is turned away before anything decodes
 * it. A file whose size can't be read isn't a picture we print.
 */
export function isPictureWithin(bytes: Uint8Array, limits: PictureLimits): boolean {
  let size: { width?: number; height?: number };
  try {
    size = imageSize(bytes);
  } catch (error) {
    // A header that can't be read (TypeError) or is cut short (RangeError): not a picture we can print.
    if (error instanceof TypeError || error instanceof RangeError) {
      return false;
    }
    throw error;
  }
  const { width, height } = size;
  return (
    width !== undefined &&
    height !== undefined &&
    width > 0 &&
    height > 0 &&
    width <= limits.width &&
    height <= limits.height
  );
}
