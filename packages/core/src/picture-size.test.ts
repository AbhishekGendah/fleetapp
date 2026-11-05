import { describe, expect, it } from "vitest";

import { isPictureWithin, PDF_PICTURE_LIMITS } from "./picture-size";

const ONE_PIXEL_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  ),
  (character) => character.charCodeAt(0),
);

describe("a picture's size, read from its header", () => {
  it("passes a small real picture", () => {
    expect(isPictureWithin(ONE_PIXEL_PNG, PDF_PICTURE_LIMITS)).toBe(true);
  });

  it("refuses one claiming more pixels than the limit, and anything not a picture (review G5-2)", () => {
    const huge = ONE_PIXEL_PNG.slice();
    // IHDR's width, at bytes 16 to 19: 1 pixel becomes 1,000,000.
    huge.set([0x00, 0x0f, 0x42, 0x40], 16);
    expect(isPictureWithin(huge, PDF_PICTURE_LIMITS)).toBe(false);
    expect(isPictureWithin(new TextEncoder().encode("not a picture"), PDF_PICTURE_LIMITS)).toBe(
      false,
    );
  });

  it("refuses a picture cut off part-way through its header, rather than failing", () => {
    // Its signature and the start of its header only: reading the size runs off the end.
    const cutShort = ONE_PIXEL_PNG.slice(0, 20);
    expect(isPictureWithin(cutShort, PDF_PICTURE_LIMITS)).toBe(false);
  });
});
