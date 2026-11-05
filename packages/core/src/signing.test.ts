import { z } from "zod";
import { describe, expect, it } from "vitest";

import { contentFingerprint } from "./document-fingerprint";
import {
  drawnSignatureInput,
  readRenterSignature,
  decodeDrawnSignature,
  isTypedNameMatching,
  MAXIMUM_DRAWN_SIGNATURE_BYTES,
  signContractInputSchema,
} from "./signing";

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const pngDataUrl = (bytes: number[]) =>
  `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
const FINGERPRINT = "a".repeat(64);

function signing(changes: Record<string, string> = {}) {
  return signContractInputSchema("Sam O'Brien-Example").safeParse({
    areDetailsConfirmed: "on",
    hasConsented: "on",
    method: "typed",
    typedName: "sam obrien example",
    drawnSignature: "",
    contractFingerprint: FINGERPRINT,
    ...changes,
  });
}

/** A real one-pixel PNG. */
const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("signing", () => {
  it("checks a typed name even before the boxes are ticked, so it shows as it is typed", () => {
    const result = signing({ areDetailsConfirmed: "", hasConsented: "", typedName: "Someone" });

    expect(result.success).toBe(false);
    expect(Object.keys(z.flattenError(result.error!).fieldErrors).sort()).toEqual([
      "areDetailsConfirmed",
      "hasConsented",
      "typedName",
    ]);
  });

  it("takes a typed name only when it is the name on the contract", () => {
    expect(isTypedNameMatching("  SAM  o'brien-example ", "Sam O'Brien-Example")).toBe(true);
    expect(isTypedNameMatching("José Núñez", "Jose Nunez")).toBe(true);
    expect(isTypedNameMatching("Sam", "Sam O'Brien-Example")).toBe(false);
    expect(isTypedNameMatching("", "")).toBe(false);
  });

  it("takes a drawn signature only as a small PNG", () => {
    const onePixel = `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`;
    expect(decodeDrawnSignature(onePixel)?.length).toBeGreaterThan(PNG_HEADER.length);
    // Not a real picture, just its first bytes.
    expect(decodeDrawnSignature(pngDataUrl([...PNG_HEADER, 1, 2, 3]))).toBeNull();
    expect(decodeDrawnSignature(pngDataUrl([0xff, 0xd8, 0xff]))).toBeNull();
    expect(decodeDrawnSignature("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
    expect(decodeDrawnSignature("data:image/png;base64,%%%")).toBeNull();
    const tooBig = new Uint8Array(MAXIMUM_DRAWN_SIGNATURE_BYTES + 1);
    tooBig.set(PNG_HEADER);
    const huge = `data:image/png;base64,${Buffer.from(tooBig).toString("base64")}`;
    expect(decodeDrawnSignature(huge)).toBeNull();
  });

  it("refuses a doctored signature claiming a huge size in a few bytes (review G5-1)", () => {
    const ihdr = [0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52];
    const size = (pixels: number) => [
      (pixels >>> 24) & 0xff,
      (pixels >>> 16) & 0xff,
      (pixels >>> 8) & 0xff,
      pixels & 0xff,
    ];
    const doctored = pngDataUrl([
      ...PNG_HEADER,
      ...ihdr,
      ...size(100_000),
      ...size(100_000),
      8,
      6,
      0,
      0,
      0,
    ]);
    expect(decodeDrawnSignature(doctored)).toBeNull();
  });

  it("needs both ticks, and a signature by the chosen method", () => {
    const issuesOf = (result: ReturnType<typeof signing>) =>
      result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
    expect(signing().success).toBe(true);
    expect(issuesOf(signing({ hasConsented: "" }))).toEqual(["hasConsented"]);
    expect(issuesOf(signing({ areDetailsConfirmed: "" }))).toEqual(["areDetailsConfirmed"]);
    expect(issuesOf(signing({ typedName: "Someone Else" }))).toEqual(["typedName"]);
    expect(issuesOf(signing({ method: "drawn" }))).toEqual(["drawnSignature"]);
    expect(issuesOf(signing({ contractFingerprint: "nope" }))).toEqual(["contractFingerprint"]);
  });
});

describe("content fingerprints", () => {
  it("ignores key order but not content", () => {
    const first = { type: "doc", content: [{ type: "text", text: "a" }] };
    const reordered = { content: [{ text: "a", type: "text" }], type: "doc" };
    expect(contentFingerprint(first)).toBe(contentFingerprint(reordered));
    expect(contentFingerprint(first)).not.toBe(
      contentFingerprint({ type: "doc", content: [{ type: "text", text: "b" }] }),
    );
  });
});

describe("a Renter's signature on the business's phone (review G9-10)", () => {
  const drawn = `data:image/png;base64,${ONE_PIXEL_PNG_BASE64}`;

  it("takes a drawing that is a small PNG", () => {
    expect(readRenterSignature(drawnSignatureInput(drawn), "Sam Example")?.method).toBe("drawn");
    expect(readRenterSignature(drawnSignatureInput(""), "Sam Example")).toBeNull();
  });

  it("takes a typed name only when it is the Renter's own", () => {
    const typed = (typedName: string) =>
      readRenterSignature({ method: "typed", typedName, drawnSignature: "" }, "Łukasz Wójcik");
    expect(typed("  Łukasz Wójcik ")).toEqual({ method: "typed", typedName: "Łukasz Wójcik" });
    expect(typed("Someone Else")).toBeNull();
  });

  it("refuses any other way of signing", () => {
    expect(
      readRenterSignature({ method: "stamped", typedName: "", drawnSignature: drawn }, "Sam"),
    ).toBeNull();
  });
});
