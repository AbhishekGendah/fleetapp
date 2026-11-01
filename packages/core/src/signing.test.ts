import { describe, expect, it } from "vitest";

import { contentFingerprint } from "./document-fingerprint";
import {
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

describe("signing", () => {
  it("takes a typed name only when it is the name on the contract", () => {
    expect(isTypedNameMatching("  SAM  o'brien-example ", "Sam O'Brien-Example")).toBe(true);
    expect(isTypedNameMatching("José Núñez", "Jose Nunez")).toBe(true);
    expect(isTypedNameMatching("Sam", "Sam O'Brien-Example")).toBe(false);
    expect(isTypedNameMatching("", "")).toBe(false);
  });

  it("takes a drawn signature only as a small PNG", () => {
    expect(decodeDrawnSignature(pngDataUrl([...PNG_HEADER, 1, 2, 3]))).toHaveLength(11);
    expect(decodeDrawnSignature(pngDataUrl([0xff, 0xd8, 0xff]))).toBeNull();
    expect(decodeDrawnSignature("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
    expect(decodeDrawnSignature("data:image/png;base64,%%%")).toBeNull();
    const tooBig = new Uint8Array(MAXIMUM_DRAWN_SIGNATURE_BYTES + 1);
    tooBig.set(PNG_HEADER);
    const huge = `data:image/png;base64,${Buffer.from(tooBig).toString("base64")}`;
    expect(decodeDrawnSignature(huge)).toBeNull();
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
