/**
 * Real, tiny files of each type we accept, for tests: the file-type check
 * reads them as it would a real upload, so a bare header is not enough.
 * Test code only (the package's `./testing` entry), never imported by an app.
 */
const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function fromBase64(encoded: string): Uint8Array {
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

function ascii(text: string): number[] {
  return [...text].map((character) => character.charCodeAt(0));
}

export const SAMPLE_PNG = fromBase64(ONE_PIXEL_PNG_BASE64);
export const SAMPLE_JPEG = Uint8Array.from([
  0xff,
  0xd8,
  0xff,
  0xe0,
  0x00,
  0x10,
  ...ascii("JFIF"),
  0x00,
  0x01,
  0x01,
  0x00,
  0x00,
  0x01,
  0x00,
  0x01,
  0x00,
  0x00,
  0xff,
  0xd9,
]);
export const SAMPLE_WEBP = Uint8Array.from([...ascii("RIFF"), 26, 0, 0, 0, ...ascii("WEBPVP8 ")]);
export const SAMPLE_PDF = new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n%%EOF\n");
