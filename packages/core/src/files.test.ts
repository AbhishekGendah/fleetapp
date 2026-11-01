import { describe, expect, it } from "vitest";

import { detectFileType } from "./file-content";
import { buildFileKey, checkUpload, downloadName, FILE_CONTENT_TYPES, photoName } from "./files";
import { SAMPLE_JPEG, SAMPLE_PDF, SAMPLE_PNG, SAMPLE_WEBP } from "./testing";

const MEGABYTE = 1024 * 1024;

function bytes(...values: Array<number | string>): Uint8Array {
  return Uint8Array.from(
    values.flatMap((value) =>
      typeof value === "string" ? [...value].map((character) => character.charCodeAt(0)) : [value],
    ),
  );
}

describe("checking an upload before it is allowed", () => {
  it("accepts a logo of an allowed type and size", () => {
    expect(checkUpload("operator_logo", "image/png", 2 * MEGABYTE)).toBeNull();
  });

  it("refuses other types, an empty file and one over the limit", () => {
    expect(checkUpload("operator_logo", "image/svg+xml", MEGABYTE)).toBe("type_not_allowed");
    expect(checkUpload("operator_logo", "application/pdf", MEGABYTE)).toBe("type_not_allowed");
    expect(checkUpload("operator_logo", "image/png", 0)).toBe("empty");
    expect(checkUpload("operator_logo", "image/png", 5 * MEGABYTE + 1)).toBe("too_large");
  });
});

describe("recognising a file from its first bytes", () => {
  it("knows PNG, JPEG, WebP and PDF", async () => {
    expect(await detectFileType(SAMPLE_PNG)).toBe(FILE_CONTENT_TYPES.png);
    expect(await detectFileType(SAMPLE_JPEG)).toBe(FILE_CONTENT_TYPES.jpeg);
    expect(await detectFileType(SAMPLE_WEBP)).toBe(FILE_CONTENT_TYPES.webp);
    expect(await detectFileType(SAMPLE_PDF)).toBe(FILE_CONTENT_TYPES.pdf);
  });

  it("refuses anything else, whatever it was called", async () => {
    expect(await detectFileType(bytes("<svg xmlns"))).toBeNull();
    expect(await detectFileType(bytes("MZ", 0x90, 0))).toBeNull();
    expect(await detectFileType(bytes("RIFF", 0, 0, 0, 0, "WAVE"))).toBeNull();
    expect(await detectFileType(new Uint8Array())).toBeNull();
  });

  it("refuses a known type we do not accept", async () => {
    expect(await detectFileType(bytes("GIF89a", 1, 0, 1, 0, 0, 0, 0))).toBeNull();
  });
});

describe("where a file lives", () => {
  it("always sits under its own Operator", () => {
    expect(buildFileKey("op-1", "operator_logo", "file-9")).toBe("op-1/operator_logo/file-9");
  });
});

describe("photo and download names", () => {
  it("names a photo by rego, day and number", () => {
    expect(photoName("1ABC234", "2026-10-30", 7)).toBe("1ABC234 2026-10-30 007");
    expect(photoName("1ABC234", "2026-10-30", 1234)).toBe("1ABC234 2026-10-30 1234");
  });

  it("gives a download its extension and drops characters that break headers", () => {
    expect(downloadName("1ABC234 2026-10-30 001", "image/jpeg")).toBe("1ABC234 2026-10-30 001.jpg");
    expect(downloadName('Report "final"\r\n', "application/pdf")).toBe("Report final.pdf");
    expect(downloadName("***", "application/pdf")).toBe("file.pdf");
  });
});
