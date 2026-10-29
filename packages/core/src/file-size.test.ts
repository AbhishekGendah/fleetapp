import { describe, expect, it } from "vitest";

import { formatFileSize } from "./file-size";

describe("writing a file size", () => {
  it("picks the unit a person would use", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(840 * 1024)).toBe("840 KB");
    expect(formatFileSize(4.2 * 1024 * 1024)).toBe("4.2 MB");
    expect(formatFileSize(3 * 1024 ** 3)).toBe("3 GB");
  });
});
