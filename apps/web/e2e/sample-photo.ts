import type { Page } from "@playwright/test";

interface Drawing {
  width: number;
  height: number;
  quality: number;
  /** Random dots rather than one colour, so it compresses badly. */
  isSpeckled: boolean;
}

type ChosenFile = { name: string; mimeType: string; buffer: Buffer };

const SAMPLE_PHOTO: Drawing = { width: 1200, height: 900, quality: 0.9, isSpeckled: false };
/** Speckled and low quality, so redrawing it at the app's quality makes it bigger. */
const SMALL_SPECKLED_PHOTO: Drawing = { width: 64, height: 48, quality: 0.1, isSpeckled: true };
const JPEG_START_LENGTH = 2;

/** What every block of hidden photo details (EXIF) starts with. */
export const PHOTO_DETAILS_MARKER = Buffer.from("Exif\0\0", "binary");

/** A real JPEG, drawn in the browser. */
async function drawnJpeg(page: Page, drawing: Drawing): Promise<Buffer> {
  const base64 = await page.evaluate(({ width, height, quality, isSpeckled }) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context && isSpeckled) {
      const pixels = context.createImageData(width, height);
      pixels.data.forEach((_, index) => {
        pixels.data[index] = index % 4 === 3 ? 255 : Math.floor(Math.random() * 256);
      });
      context.putImageData(pixels, 0, 0);
    } else if (context) {
      context.fillStyle = "#2b6";
      context.fillRect(0, 0, width, height);
    }
    return canvas.toDataURL("image/jpeg", quality).split(",")[1] ?? "";
  }, drawing);
  return Buffer.from(base64, "base64");
}

/** A real JPEG photo, drawn in the browser, as a file to choose in a file box. */
export async function samplePhoto(page: Page, name: string): Promise<ChosenFile> {
  return { name, mimeType: "image/jpeg", buffer: await drawnJpeg(page, SAMPLE_PHOTO) };
}

/**
 * A hidden-details block saying where the photo was taken: a minimal TIFF
 * holding a location section (GPS latitude "S"). Big-endian, offsets from
 * the TIFF start.
 */
function locationDetailsBlock(): Buffer {
  // prettier-ignore
  const tiff = Buffer.from([
    // Header: big-endian TIFF, first section at byte 8.
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
    // Main section: one entry, "location section at byte 26", then no next section.
    0x00, 0x01, 0x88, 0x25, 0x00, 0x04, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x1a,
    0x00, 0x00, 0x00, 0x00,
    // Location section: one entry, latitude reference "S", then no next section.
    0x00, 0x01, 0x00, 0x01, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02, 0x53, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const body = Buffer.concat([PHOTO_DETAILS_MARKER, tiff]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(body.length + 2);
  return Buffer.concat([Buffer.from([0xff, 0xe1]), length, body]);
}

/**
 * A small, well-compressed photo that says where it was taken: the kind the
 * shrinker used to hand back untouched (review A7-9).
 */
export async function smallPhotoWithLocation(page: Page, name: string): Promise<ChosenFile> {
  const plain = await drawnJpeg(page, SMALL_SPECKLED_PHOTO);
  const buffer = Buffer.concat([
    plain.subarray(0, JPEG_START_LENGTH),
    locationDetailsBlock(),
    plain.subarray(JPEG_START_LENGTH),
  ]);
  return { name, mimeType: "image/jpeg", buffer };
}
