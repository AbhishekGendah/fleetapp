import { describe, expect, it } from "vitest";

import {
  buildFileKey,
  checkUpload,
  detectFileType,
  downloadName,
  FILE_CONTENT_TYPES,
  photoName,
} from "./files";

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
  it("knows PNG, JPEG, WebP and PDF", () => {
    expect(detectFileType(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0))).toBe(
      FILE_CONTENT_TYPES.png,
    );
    expect(detectFileType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe(FILE_CONTENT_TYPES.jpeg);
    expect(detectFileType(bytes("RIFF", 0, 0, 0, 0, "WEBP"))).toBe(FILE_CONTENT_TYPES.webp);
    expect(detectFileType(bytes("%PDF-1.7"))).toBe(FILE_CONTENT_TYPES.pdf);
  });

  it("refuses anything else, whatever it was called", () => {
    expect(detectFileType(bytes("<svg xmlns"))).toBeNull();
    expect(detectFileType(bytes("MZ", 0x90, 0))).toBeNull();
    expect(detectFileType(bytes("RIFF", 0, 0, 0, 0, "WAVE"))).toBeNull();
    expect(detectFileType(new Uint8Array())).toBeNull();
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
