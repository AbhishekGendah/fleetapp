import type { Page } from "@playwright/test";

const PHOTO_SIZE = { width: 1200, height: 900 } as const;
const JPEG_QUALITY = 0.9;

/** A real JPEG photo, drawn in the browser, as a file to choose in a file box. */
export async function samplePhoto(
  page: Page,
  name: string,
): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
  const base64 = await page.evaluate(
    ({ size, quality }) => {
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext("2d");
      if (context) {
        context.fillStyle = "#2b6";
        context.fillRect(0, 0, size.width, size.height);
      }
      return canvas.toDataURL("image/jpeg", quality).split(",")[1] ?? "";
    },
    { size: PHOTO_SIZE, quality: JPEG_QUALITY },
  );
  return { name, mimeType: "image/jpeg", buffer: Buffer.from(base64, "base64") };
}
